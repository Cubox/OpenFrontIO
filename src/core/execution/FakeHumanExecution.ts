import {
  Cell,
  Difficulty,
  Execution,
  Game,
  Gold,
  Nation,
  Player,
  PlayerID,
  PlayerType,
  Relation,
  TerrainType,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { euclDistFN, manhattanDistFN, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { calculateBoundingBox, flattenedEmojiTable, simpleHash } from "../Util";
import { ConstructionExecution } from "./ConstructionExecution";
import { EmojiExecution } from "./EmojiExecution";
import { MirvExecution } from "./MIRVExecution";
import { NukeExecution } from "./NukeExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TrainStationExecution } from "./TrainStationExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";
import { closestTwoTiles } from "./Util";
import { BotBehavior } from "./utils/BotBehavior";

export class FakeHumanExecution implements Execution {
  private firstMove = true;

  private active = true;
  private random: PseudoRandom;
  private behavior: BotBehavior | null = null;
  private mg: Game;
  private player: Player | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;

  private lastEmojiSent = new Map<Player, Tick>();
  private lastNukeSent: [Tick, TileRef][] = [];
  private embargoMalusApplied = new Set<PlayerID>();
  private heckleEmoji: number[];
  private lastMassRetaliation = new Map<PlayerID, Tick>();

  constructor(
    gameID: GameID,
    private nation: Nation,
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.attackRate = this.random.nextInt(10, 20);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(60, 90) / 100;
    this.reserveRatio = this.random.nextInt(30, 60) / 100;
    this.heckleEmoji = ["🤡", "😡"].map((e) => flattenedEmojiTable.indexOf(e));
  }

  init(mg: Game) {
    this.mg = mg;
    if (this.random.chance(10)) {
      // this.isTraitor = true
    }
  }

  private updateRelationsFromEmbargos() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        player.relation(other) <= Relation.Hostile &&
        !player.hasEmbargoAgainst(other)
      ) {
        player.addEmbargo(other.id(), false);
      } else if (
        player.relation(other) >= Relation.Neutral &&
        player.hasEmbargoAgainst(other)
      ) {
        player.stopEmbargo(other.id());
      }
    });
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (this.mg.inSpawnPhase()) {
      const rl = this.randomLand();
      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }
      this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, rl));
      return;
    }

    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.nation.playerInfo.id) ??
        null;
      if (this.player === null) {
        return;
      }
    }

    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    if (this.behavior === null) {
      // Player is unavailable during init()
      this.behavior = new BotBehavior(
        this.random,
        this.mg,
        this.player,
        this.triggerRatio,
        this.reserveRatio,
      );
    }

    if (this.firstMove) {
      this.firstMove = false;
      this.behavior.sendAttack(this.mg.terraNullius());
      return;
    }

    if (
      this.player.troops() > 100_000 &&
      this.player.targetTroopRatio() > 0.7
    ) {
      this.player.setTargetTroopRatio(0.7);
    }

    this.updateRelationsFromEmbargos();
    this.behavior.handleAllianceRequests();
    this.handleEnemies();
    this.handleUnits();
    this.handleEmbargoesToHostileNations();
    this.maybeAttack();
  }

  private maybeAttack() {
    if (this.player === null || this.behavior === null) {
      throw new Error("not initialized");
    }
    const enemyborder = Array.from(this.player.borderTiles())
      .flatMap((t) => this.mg.neighbors(t))
      .filter(
        (t) =>
          this.mg.isLand(t) && this.mg.ownerID(t) !== this.player?.smallID(),
      );

    if (enemyborder.length === 0) {
      if (this.random.chance(10)) {
        this.sendBoatRandomly();
      }
      return;
    }
    if (this.random.chance(20)) {
      this.sendBoatRandomly();
      return;
    }

    const enemiesWithTN = enemyborder.map((t) =>
      this.mg.playerBySmallID(this.mg.ownerID(t)),
    );
    if (enemiesWithTN.filter((o) => !o.isPlayer()).length > 0) {
      this.behavior.sendAttack(this.mg.terraNullius());
      return;
    }

    const enemies = enemiesWithTN
      .filter((o) => o.isPlayer())
      .sort((a, b) => a.troops() - b.troops());

    // 5% chance to send a random alliance request
    if (this.random.chance(20)) {
      const toAlly = this.random.randElement(enemies);
      if (this.player.canSendAllianceRequest(toAlly)) {
        this.player.createAllianceRequest(toAlly);
        return;
      }
    }

    // 50-50 attack weakest player vs random player
    const toAttack = this.random.chance(2)
      ? enemies[0]
      : this.random.randElement(enemies);
    if (this.shouldAttack(toAttack)) {
      this.behavior.sendAttack(toAttack);
    }
  }

  private shouldAttack(other: Player): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (this.player.isOnSameTeam(other)) {
      return false;
    }
    if (this.player.isFriendly(other)) {
      if (this.shouldDiscourageAttack(other)) {
        return this.random.chance(200);
      }
      return this.random.chance(50);
    } else {
      if (this.shouldDiscourageAttack(other)) {
        return this.random.chance(4);
      }
      return true;
    }
  }

  private shouldDiscourageAttack(other: Player) {
    if (other.isTraitor()) {
      return false;
    }
    const difficulty = this.mg.config().gameConfig().difficulty;
    if (
      difficulty === Difficulty.Hard ||
      difficulty === Difficulty.Impossible
    ) {
      return false;
    }
    if (other.type() !== PlayerType.Human) {
      return false;
    }
    // Only discourage attacks on Humans who are not traitors on easy or medium difficulty.
    return true;
  }

  handleEnemies() {
    if (this.player === null || this.behavior === null) {
      throw new Error("not initialized");
    }
    this.behavior.forgetOldEnemies();
    this.behavior.assistAllies();
    const enemy = this.behavior.selectEnemy();
    if (!enemy) return;
    this.maybeSendEmoji(enemy);
    this.maybeSendNuke(enemy);
    if (this.player.sharesBorderWith(enemy)) {
      this.behavior.sendAttack(enemy);
    } else {
      this.maybeSendBoatAttack(enemy);
    }
  }

  private maybeSendEmoji(enemy: Player) {
    if (this.player === null) throw new Error("not initialized");
    if (enemy.type() !== PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.mg.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(enemy, this.mg.ticks());
    this.mg.addExecution(
      new EmojiExecution(
        this.player,
        enemy.id(),
        this.random.randElement(this.heckleEmoji),
      ),
    );
  }

  private maybeSendNuke(other: Player) {
    if (this.player === null) throw new Error("not initialized");
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      other.type() === PlayerType.Bot ||
      this.player.isOnSameTeam(other)
    ) {
      return;
    }

    // Detect whether the opponent is actively attacking or nuking us
    const isActiveAttacker = this.isActiveAttacker(other);

    // NEW: determine if the opponent currently poses a serious threat.
    const underThreat = this.isExistentialThreat(other);

    const structures = other.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles: (TileRef | null)[] = new Array(10);
    for (let i = 0; i < randomTiles.length; i++) {
      randomTiles[i] = this.randTerritoryTile(other);
    }
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = 0;
    this.removeOldNukeEvents();
    outer: for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      // Reduce the required depth inside enemy territory when we're under heavy attack
      const requiredRadius = underThreat ? 5 : 15;
      for (const t of this.mg.bfs(
        tile,
        manhattanDistFN(tile, requiredRadius),
      )) {
        // Ensure most of the blast radius is still in enemy territory
        if (this.mg.owner(t) !== other) {
          continue outer;
        }
      }
      const value = this.nukeTileScore(tile, silos, structures);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }

    const readySilos = silos.filter((s) => !s.isInCooldown());

    // Determine number of launches. If enemy's incoming force is > 2x our troops, keep firing until broke.
    let launches = 1;
    if (isActiveAttacker) {
      const incomingTroops = this.player
        .incomingAttacks()
        .filter((a) => a.attacker() === other && a.isActive())
        .reduce((sum, a) => sum + a.troops(), 0);
      const lastRiposte = this.lastMassRetaliation.get(other.id()) ?? -Infinity;
      const riposteCooldown = 500; // ticks before we retaliate again
      const isTimeForRiposte = this.mg.ticks() - lastRiposte > riposteCooldown;

      if (incomingTroops > this.player.troops() * 2 && isTimeForRiposte) {
        // Launch until out of affordable nukes or silos
        launches = Number.MAX_SAFE_INTEGER;
      } else {
        launches = readySilos.length;
      }
    }

    if (
      launches === Number.MAX_SAFE_INTEGER ||
      launches > readySilos.length / 2
    ) {
      // Record riposte timestamp to avoid frequent mass nuking
      this.lastMassRetaliation.set(other.id(), this.mg.ticks());
    }

    if (bestTile !== null) {
      let launched = 0;
      const cheapCost = this.cost(UnitType.AtomBomb);
      for (let i = 0; i < launches && launched < readySilos.length; i++) {
        if (this.player.gold() < cheapCost) break;
        this.sendSmartNuke(bestTile, other, bestValue);
        launched++;
      }
    } else if (underThreat) {
      // Fallback: nuke the center of the biggest incoming attack stack
      const incoming = this.player
        .incomingAttacks()
        .filter((a) => a.attacker() === other && a.isActive());
      if (incoming.length > 0) {
        const largest = incoming.reduce(
          (max, a) => (a.troops() > max.troops() ? a : max),
          incoming[0],
        );
        const pos = largest.averagePosition();
        if (pos !== null) {
          const tile = this.mg.ref(Math.round(pos.x), Math.round(pos.y));
          const dummyValue = 50_000; // arbitrary value to favor MIRV/hydrogen if affordable
          this.sendSmartNuke(tile, other, dummyValue);
        }
      }
    }
  }

  private removeOldNukeEvents() {
    const maxAge = 500;
    const tick = this.mg.ticks();
    while (
      this.lastNukeSent.length > 0 &&
      this.lastNukeSent[0][0] + maxAge < tick
    ) {
      this.lastNukeSent.shift();
    }
  }

  private sendSmartNuke(tile: TileRef, enemy: Player, value: number) {
    if (this.player === null) throw new Error("not initialized");

    // Determine threat level
    const isExistentialThreat = this.isExistentialThreat(enemy);
    const isHighValueTarget = value > 100_000;
    const enemyHasSAMs = enemy.units(UnitType.SAMLauncher).length > 0;

    // MIRV decision logic
    const canAffordMIRV = this.player.gold() >= this.cost(UnitType.MIRV);
    const canAffordHydrogen =
      this.player.gold() >= this.cost(UnitType.HydrogenBomb);
    const canAffordAtom = this.player.gold() >= this.cost(UnitType.AtomBomb);

    if (
      canAffordMIRV &&
      (isExistentialThreat || (isHighValueTarget && enemyHasSAMs))
    ) {
      // Use MIRV for existential threats or high-value targets defended by SAMs
      this.mg.addExecution(new MirvExecution(this.player, tile));
      this.lastNukeSent.push([this.mg.ticks(), tile]);
    } else if (canAffordHydrogen && isHighValueTarget) {
      // Use Hydrogen Bomb for high-value targets
      this.mg.addExecution(
        new NukeExecution(UnitType.HydrogenBomb, this.player, tile, null),
      );
      this.lastNukeSent.push([this.mg.ticks(), tile]);
    } else if (canAffordAtom) {
      // Use Atom Bomb as fallback
      this.mg.addExecution(
        new NukeExecution(UnitType.AtomBomb, this.player, tile, null),
      );
      this.lastNukeSent.push([this.mg.ticks(), tile]);
    }
  }

  private isExistentialThreat(enemy: Player): boolean {
    if (this.player === null) throw new Error("not initialized");

    // Enemy is existential threat if:
    // 1. They control notably more territory than us
    const territoryRatio =
      enemy.numTilesOwned() / Math.max(1, this.player.numTilesOwned());
    if (territoryRatio > 2.0) return true;

    // 2. They field a substantially larger army
    const troopRatio = enemy.troops() / Math.max(1, this.player.troops());
    if (troopRatio > 2.5) return true;

    // 3. Their active invasion force is sizeable
    const incomingAttacks = this.player
      .incomingAttacks()
      .filter((a) => a.attacker() === enemy);
    const totalIncomingTroops = incomingAttacks.reduce(
      (sum, a) => sum + a.troops(),
      0,
    );
    if (totalIncomingTroops > this.player.troops() * 0.25) return true;

    return false;
  }

  private sendNuke(tile: TileRef) {
    if (this.player === null) throw new Error("not initialized");
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.mg.addExecution(
      new NukeExecution(UnitType.AtomBomb, this.player, tile),
    );
  }

  private nukeTileScore(tile: TileRef, silos: Unit[], targets: Unit[]): number {
    // Potential damage in a 25-tile radius
    const dist = euclDistFN(tile, 25, false);
    let tileValue = targets
      .filter((unit) => dist(this.mg, unit.tile()))
      .map((unit) => {
        switch (unit.type()) {
          case UnitType.City:
            return 25_000;
          case UnitType.DefensePost:
            return 5_000;
          case UnitType.MissileSilo:
            return 50_000;
          case UnitType.Port:
            return 10_000;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Avoid areas defended by SAM launchers
    const dist50 = euclDistFN(tile, 50, false);
    tileValue -=
      50_000 *
      targets.filter(
        (unit) =>
          unit.type() === UnitType.SAMLauncher && dist50(this.mg, unit.tile()),
      ).length;

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.mg, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.mg.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private maybeSendBoatAttack(other: Player) {
    if (this.player === null) throw new Error("not initialized");
    if (this.player.isOnSameTeam(other)) return;
    const closest = closestTwoTiles(
      this.mg,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.mg.isOceanShore(t),
      ),
      Array.from(other.borderTiles()).filter((t) => this.mg.isOceanShore(t)),
    );
    if (closest === null) {
      return;
    }
    this.mg.addExecution(
      new TransportShipExecution(
        this.player,
        other.id(),
        closest.y,
        this.player.troops() / 5,
        null,
      ),
    );
  }

  private handleUnits() {
    const player = this.player;
    if (player === null) return;

    // Phase 1: Targeted building with limits and smart upgrades
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 1)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.City, 1)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.MissileSilo, 1)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.City, 2)) {
      return;
    }
    if (this.maybeSpawnWarship()) {
      return;
    }
    if (this.maybeSpawnTrainStation()) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.MissileSilo, 2)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 2)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.City, 3)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.SAMLauncher, 1)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 3)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.City, 4)) {
      return;
    }
    if (this.maybeSpawnWarship()) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.Factory, 1)) {
      return;
    }
    if (this.maybeSpawnStructurePhase1(UnitType.City, 5)) {
      return;
    }

    // Phase 2: Randomized expansion including upgrades as active choices
    const expansionActions = [
      { type: "build", unitType: UnitType.Port },
      { type: "build", unitType: UnitType.City },
      { type: "build", unitType: UnitType.MissileSilo },
      { type: "build", unitType: UnitType.SAMLauncher },
      { type: "build", unitType: UnitType.Factory },
      { type: "upgrade", unitType: UnitType.Port },
      { type: "upgrade", unitType: UnitType.City },
      { type: "upgrade", unitType: UnitType.MissileSilo },
      { type: "upgrade", unitType: UnitType.SAMLauncher },
      { type: "upgrade", unitType: UnitType.Factory },
    ];

    // Shuffle the actions randomly each tick
    const shuffledActions = [...expansionActions];
    for (let i = shuffledActions.length - 1; i > 0; i--) {
      const j = this.random.nextInt(0, i + 1);
      [shuffledActions[i], shuffledActions[j]] = [
        shuffledActions[j],
        shuffledActions[i],
      ];
    }

    for (const action of shuffledActions) {
      if (action.type === "build") {
        if (this.maybeSpawnStructureUnlimited(action.unitType)) {
          return;
        }
      } else if (action.type === "upgrade") {
        if (this.maybeUpgradeStructureType(action.unitType)) {
          return;
        }
      }
    }
  }

  private maybeSpawnStructurePhase1(type: UnitType, maxNum: number): boolean {
    if (this.player === null) throw new Error("not initialized");

    // Phase 1: If we already have max buildings of this type, just skip to next
    if (this.player.unitsOwned(type) >= maxNum) {
      return false;
    }

    const cost = this.cost(type);
    const goldReserve = this.calculateGoldReserve();

    // Only build if we can afford it while maintaining gold reserve
    if (this.player.gold() - cost < goldReserve) {
      return false;
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.mg.addExecution(new ConstructionExecution(this.player, tile, type));
    return true;
  }

  private maybeUpgradeStructureType(type: UnitType): boolean {
    if (this.player === null) throw new Error("not initialized");

    const upgradableUnits = this.player
      .units(type)
      .filter((unit) => this.mg.unitInfo(type).upgradable);

    if (upgradableUnits.length === 0) return false;

    const cost = this.mg.unitInfo(type).cost(this.player);
    const goldReserve = this.calculateGoldReserve();
    if (this.player.gold() - cost < goldReserve) return false;

    // Find the lowest level unit that would benefit from upgrading
    let bestCandidate: Unit | null = null;
    for (const unit of upgradableUnits) {
      if (this.isUpgradeBeneficial(unit)) {
        if (bestCandidate === null || unit.level() < bestCandidate.level()) {
          bestCandidate = unit;
        }
      }
    }

    if (bestCandidate === null) return false;

    this.mg.addExecution(
      new UpgradeStructureExecution(this.player, bestCandidate.id()),
    );
    return true;
  }

  private isUpgradeBeneficial(unit: Unit): boolean {
    const currentLevel = unit.level();
    const unitType = unit.type();

    switch (unitType) {
      case UnitType.Port: {
        // For ports, upgrades are always beneficial as they increase trade revenue
        return true;
      }

      // For other upgradable structures, upgrades are always beneficial
      // (factories increase gold income, cities increase population, etc.)
      case UnitType.Factory:
      case UnitType.City:
      case UnitType.MissileSilo:
      case UnitType.SAMLauncher:
        return true;

      default:
        return true;
    }
  }

  private maybeSpawnStructureUnlimited(type: UnitType): boolean {
    if (this.player === null) throw new Error("not initialized");

    const cost = this.mg.unitInfo(type).cost(this.player);
    const goldReserve = this.calculateGoldReserve();

    // Only build if we can afford it while maintaining gold reserve
    if (this.player.gold() - cost < goldReserve) {
      return false;
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }

    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }

    this.mg.addExecution(new ConstructionExecution(this.player, tile, type));
    return true;
  }

  private structureSpawnTile(type: UnitType): TileRef | null {
    if (this.player === null) throw new Error("not initialized");

    let tiles: TileRef[];
    if (type === UnitType.Port) {
      tiles = Array.from(this.player.borderTiles()).filter((t) =>
        this.mg.isOceanShore(t),
      );
    } else {
      tiles = Array.from(this.player.tiles());
    }

    if (tiles.length === 0) {
      return null;
    }

    return this.random.randElement(tiles);
  }

  private maybeSpawnWarship(): boolean {
    if (this.player === null) throw new Error("not initialized");

    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    const cost = this.cost(UnitType.Warship);
    const goldReserve = this.calculateGoldReserve();

    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() - cost >= goldReserve
    ) {
      // Only use randomness when we can actually build
      if (!this.random.chance(50)) {
        return false;
      }

      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile());
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        console.warn("cannot spawn destroyer");
        return false;
      }
      this.mg.addExecution(
        new ConstructionExecution(this.player, targetTile, UnitType.Warship),
      );
      return true;
    }
    return false;
  }

  private randTerritoryTile(p: Player): TileRef | null {
    const boundingBox = calculateBoundingBox(this.mg, p.borderTiles());
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.mg.isOnMap(new Cell(randX, randY))) {
        // Sanity check should never happen
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (this.mg.owner(randTile) === p) {
        return randTile;
      }
    }
    return null;
  }

  private warshipSpawnTile(portTile: TileRef): TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.mg.x(portTile) - radius,
        this.mg.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.mg.y(portTile) - radius,
        this.mg.y(portTile) + radius,
      );
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.mg.ref(randX, randY);
      // Sanity check
      if (!this.mg.isOcean(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  private cost(type: UnitType): Gold {
    if (this.player === null) throw new Error("not initialized");
    return this.mg.unitInfo(type).cost(this.player);
  }

  private calculateGoldReserve(): Gold {
    if (this.player === null) throw new Error("not initialized");

    // Dynamic gold reserve based on buildings owned
    // Formula: 1M gold reserve per 5 buildings owned
    const buildings = this.player.units(
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.MissileSilo,
      UnitType.SAMLauncher,
      UnitType.DefensePost,
    );

    // Each building level counts as one towards the reserve calculation
    const buildingCount = buildings.reduce(
      (sum, unit) => sum + unit.level(),
      0,
    );

    // Calculate reserve: (buildings / 5) * 1M
    const reserveMultiplier = BigInt(Math.floor(buildingCount / 5));
    let dynamicReserve = reserveMultiplier * 1_000_000n; // 1M per 5 buildings

    // Ensure the bot always keeps a sensible minimum reserve.
    const minReserve = 0n; // 0 baseline
    if (dynamicReserve < minReserve) {
      dynamicReserve = minReserve;
    }

    // Cap the reserve to prevent excessive hoarding.
    const maxReserve = 50_000_000n; // 50M
    if (dynamicReserve > maxReserve) return maxReserve;

    return dynamicReserve;
  }

  sendBoatRandomly() {
    if (this.player === null) throw new Error("not initialized");
    const oceanShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    if (oceanShore.length === 0) {
      return;
    }

    const src = this.random.randElement(oceanShore);

    const dst = this.randOceanShoreTile(src, 150);
    if (dst === null) {
      return;
    }

    this.mg.addExecution(
      new TransportShipExecution(
        this.player,
        this.mg.owner(dst).id(),
        dst,
        this.player.troops() / 5,
        null,
      ),
    );
    return;
  }

  randomLand(): TileRef | null {
    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  private randOceanShoreTile(tile: TileRef, dist: number): TileRef | null {
    if (this.player === null) throw new Error("not initialized");
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - dist, x + dist);
      const randY = this.random.nextInt(y - dist, y + dist);
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (!this.mg.isOceanShore(randTile)) {
        continue;
      }
      const owner = this.mg.owner(randTile);
      if (!owner.isPlayer()) {
        return randTile;
      }
      if (!owner.isFriendly(this.player)) {
        return randTile;
      }
    }
    return null;
  }

  private maybeSpawnTrainStation(): boolean {
    if (this.mg.config().isUnitDisabled(UnitType.Train)) {
      return false;
    }
    if (this.player === null) throw new Error("not initialized");
    const citiesWithoutStations = this.player.units().filter((unit) => {
      switch (unit.type()) {
        case UnitType.City:
        case UnitType.Port:
        case UnitType.Factory:
          return !unit.hasTrainStation();
        default:
          return false;
      }
    });
    if (citiesWithoutStations.length === 0) {
      return false;
    }
    this.mg.addExecution(
      new TrainStationExecution(this.player, citiesWithoutStations[0].id()),
    );
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  // Consider an enemy "active attacker" if they currently have an attack or nuke inbound
  private isActiveAttacker(enemy: Player): boolean {
    if (this.player === null) throw new Error("not initialized");

    // Ongoing troop attacks
    const incomingAttacks = this.player
      .incomingAttacks()
      .filter((a) => a.attacker() === enemy && a.isActive());
    if (incomingAttacks.length > 0) return true;

    // Incoming nukes – check for any active NukeExecution targeting us
    const mgExecs: Execution[] =
      (
        this.mg as unknown as { executions?: () => Execution[] }
      ).executions?.() ?? [];
    const incomingNukes = mgExecs.filter(
      (e): e is NukeExecution => e instanceof NukeExecution,
    );
    for (const ne of incomingNukes) {
      // Skip nukes that haven't been initialized yet (mg undefined)
      try {
        const targetOwner = ne.target();
        if (targetOwner.isPlayer() && targetOwner === this.player) return true;
      } catch {
        // ignore uninitialized execution
        continue;
      }
    }

    return false;
  }
}
