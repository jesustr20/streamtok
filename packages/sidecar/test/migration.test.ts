import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCommunityRules, type MappingRule } from "@streamtok/shared";
import {
  communityRulesToAccionesEventos,
  mappingRuleToAccionEvento,
  migrateLegacyRules,
  migrateProfile,
  migrateProfilesFile,
} from "../src/migration.js";
import { ProfilesStore } from "../src/profiles.js";

const giftRule: MappingRule = {
  id: "r1",
  when: { event: "gift", giftId: 5655 },
  action: "arena_join",
  params: { character: "default" },
  passCoinsAsParam: "coins",
};

const commentRule: MappingRule = {
  id: "r2",
  when: { event: "comment", command: "!carro" },
  action: "vehicle_spawn_random",
  params: { amount: 1 },
};

const likeRule: MappingRule = {
  id: "r3",
  when: { event: "like" },
  action: "arena_join",
  params: {},
};

describe("mappingRuleToAccionEvento", () => {
  it("gift con giftId → regaloEspecifico", () => {
    const { accion, evento } = mappingRuleToAccionEvento(giftRule);
    expect(accion.comandos).toEqual([{ modActionId: "arena_join", params: { character: "default" } }]);
    expect(evento.porque).toBe("regaloEspecifico");
    expect(evento.giftId).toBe("5655");
    expect(evento.accionesIds).toEqual([accion.id]);
    expect(evento.activo).toBe(true);
  });

  it("comment con comando → comando", () => {
    const { evento } = mappingRuleToAccionEvento(commentRule);
    expect(evento.porque).toBe("comando");
    expect(evento.comando).toBe("!carro");
  });

  it("like → likes con umbral 1 (cada like)", () => {
    const { evento } = mappingRuleToAccionEvento(likeRule);
    expect(evento.porque).toBe("likes");
    expect(evento.cantidadMinimaLikes).toBe(1);
  });

  it("follow → seguir", () => {
    const { evento } = mappingRuleToAccionEvento({
      id: "r4",
      when: { event: "follow" },
      action: "x",
      params: {},
    });
    expect(evento.porque).toBe("seguir");
  });
});

describe("communityRulesToAccionesEventos", () => {
  it("mapea los 4 slots y preserva enabled→activo y el umbral de likes", () => {
    const cr = {
      ...defaultCommunityRules(),
      follow: { enabled: true, action: "arena_join", params: { character: "default" } },
      share: { enabled: false, action: "arena_join", params: {} },
      superfan: { enabled: true, action: "vehicle_spawn", params: {} },
      like: { enabled: true, action: "arena_join", params: {}, everyNLikes: 7 },
    };
    const { acciones, eventos } = communityRulesToAccionesEventos(cr);

    expect(acciones).toHaveLength(4);
    expect(eventos).toHaveLength(4);

    const follow = eventos.find((e) => e.porque === "seguir")!;
    expect(follow.activo).toBe(true);
    const share = eventos.find((e) => e.porque === "compartir")!;
    expect(share.activo).toBe(false);
    const superfan = eventos.find((e) => e.porque === "suscribirse")!;
    expect(superfan.activo).toBe(true);
    const like = eventos.find((e) => e.porque === "likes")!;
    expect(like.cantidadMinimaLikes).toBe(7);

    // cada evento referencia su propia acción, presente en la lista
    for (const ev of eventos) {
      expect(ev.accionesIds).toHaveLength(1);
      expect(acciones.some((a) => a.id === ev.accionesIds[0])).toBe(true);
    }
  });

  it("no migra slots sin acción asignada", () => {
    const { acciones, eventos } = communityRulesToAccionesEventos(defaultCommunityRules());
    expect(acciones).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });
});

describe("migrateProfilesFile", () => {
  it("forma nueva → passthrough (idempotente)", () => {
    const nuevo = {
      profiles: [{ id: "p1", name: "Uno", acciones: [], eventos: [] }],
      activeProfileId: "p1",
    };
    expect(migrateProfilesFile(nuevo)).toEqual(nuevo);
  });

  it("forma vieja (rules + communityRules) → acciones/eventos", () => {
    const viejo = {
      profiles: [
        {
          id: "p1",
          name: "Uno",
          rules: [giftRule],
          communityRules: {
            ...defaultCommunityRules(),
            follow: { enabled: true, action: "arena_join", params: {} },
          },
        },
      ],
      activeProfileId: "p1",
    };
    const result = migrateProfilesFile(viejo)!;
    expect(result).not.toBeNull();
    expect(result.profiles[0].acciones).toHaveLength(2); // 1 de mapping + 1 de comunidad
    expect(result.profiles[0].eventos).toHaveLength(2);
    expect(result.profiles[0].eventos.some((e) => e.porque === "regaloEspecifico")).toBe(true);
    expect(result.profiles[0].eventos.some((e) => e.porque === "seguir")).toBe(true);
  });

  it("irreconocible → null", () => {
    expect(migrateProfilesFile(null)).toBeNull();
    expect(migrateProfilesFile({ activeProfileId: "x" })).toBeNull();
  });
});

describe("ProfilesStore — migración de disco", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function tmpDir(): { profilesPath: string; legacyPath: string } {
    dir = mkdtempSync(join(tmpdir(), "streamtok-migration-"));
    return { profilesPath: join(dir, "profiles.json"), legacyPath: join(dir, "mapping-rules.json") };
  }

  it("migra profiles.json viejo a acciones/eventos y lo persiste sin duplicar", async () => {
    const { profilesPath, legacyPath } = tmpDir();
    writeFileSync(
      profilesPath,
      JSON.stringify({
        profiles: [{ id: "p1", name: "Uno", rules: [giftRule, commentRule] }],
        activeProfileId: "p1",
      }),
    );

    const store = new ProfilesStore(profilesPath, legacyPath);
    const file = store.load();
    expect(file.profiles[0].eventos).toHaveLength(2);
    expect(file.profiles[0].acciones).toHaveLength(2);
    expect((file.profiles[0] as any).rules).toBeUndefined();

    // al persistir y releer, NO se vuelve a migrar (idempotente)
    await store.save(file);
    const reloaded = new ProfilesStore(profilesPath, legacyPath).load();
    expect(reloaded.profiles[0].eventos).toHaveLength(2);
    expect(reloaded.profiles[0].acciones).toHaveLength(2);
  });

  it("migra mapping-rules.json plano a un perfil con acciones/eventos", () => {
    const { profilesPath, legacyPath } = tmpDir();
    writeFileSync(legacyPath, JSON.stringify([giftRule]));

    const file = new ProfilesStore(profilesPath, legacyPath).load();
    expect(file.profiles).toHaveLength(1);
    expect(file.profiles[0].name).toBe("Predeterminado");
    expect(file.profiles[0].eventos).toHaveLength(1);
    expect(file.profiles[0].eventos[0].porque).toBe("regaloEspecifico");
    expect(file.profiles[0].acciones).toHaveLength(1);
  });

  it("migrateLegacyRules produce 1 acción y 1 evento por regla", () => {
    const { acciones, eventos } = migrateLegacyRules([giftRule, commentRule, likeRule]);
    expect(acciones).toHaveLength(3);
    expect(eventos).toHaveLength(3);
    expect(eventos.map((e) => e.porque)).toEqual(["regaloEspecifico", "comando", "likes"]);
  });
});

describe("migrateProfile", () => {
  it("perfil nuevo pasa tal cual", () => {
    const p = { id: "p1", name: "Uno", acciones: [], eventos: [] };
    expect(migrateProfile(p)).toEqual(p);
  });

  it("perfil viejo sin communityRules migra sus rules", () => {
    const legacy = { id: "p1", name: "Uno", rules: [giftRule] };
    const result = migrateProfile(legacy)!;
    expect(result.acciones).toHaveLength(1);
    expect(result.eventos).toHaveLength(1);
  });
});
