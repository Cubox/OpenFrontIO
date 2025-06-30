import {
  Execution,
  Game,
  Gold,
  Player,
  PlayerType,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { ConstructionExecution } from "./ConstructionExecution";
import { TrainStationExecution } from "./TrainStationExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";

export class DelegatedBuildingExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private player: Player | null = null;

  private buildRate: number;
  private buildTick: number;
  private goldReserve: Gold;
  private isEnabled: boolean;

  constructor(
    gameID: GameID,
    private playerId: string,
    goldReserve: number = 500000,
    enabled: boolean = false,
  ) {
    this.random = new PseudoRandom(
      simpleHash(playerId) + simpleHash(gameID) + 42,
    );
    this.buildRate = this.random.nextInt(30, 60); // Build every 30-60 ticks
    this.buildTick = this.random.nextInt(0, this.buildRate);
    this.goldReserve = BigInt(goldReserve);
    this.isEnabled = enabled;
  }

  init(mg: Game) {
    this.mg = mg;
  }

  // Update delegation settings
  updateSettings(goldReserve: number, enabled: boolean) {
    this.goldReserve = BigInt(goldReserve);
    this.isEnabled = enabled;
  }

  tick(ticks: number) {
    if (!this.isEnabled || ticks % this.buildRate !== this.buildTick) return;

    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.playerId) ?? null;
      if (this.player === null || this.player.type() !== PlayerType.Human) {
        return;
      }
    }

    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    // Only build if we have more gold than the reserve amount
    if (this.player.gold() <= this.goldReserve) {
      return;
    }

    // Try to build/upgrade in priority order
    this.handleBuilding();
  }

  private handleBuilding() {
    if (this.player === null) return;

    // Extended AI algorithm order with limits and smart upgrades
    // Same progression as FakeHuman but only structures (no warships/trains)
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 1)) {
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
    if (this.maybeSpawnStructurePhase1(UnitType.MissileSilo, 1)) {
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
    if (this.player === null) return false;

    // Phase 1: If we already have max buildings of this type, just skip to next
    if (this.player.unitsOwned(type) >= maxNum) {
      return false;
    }

    const cost = this.mg.unitInfo(type).cost(this.player);

    // Check if we can afford it while maintaining reserve
    if (this.player.gold() - cost < this.goldReserve) {
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

  private maybeSpawnStructure(type: UnitType, maxNum: number): boolean {
    if (this.player === null) return false;

    // If we already have max buildings of this type, try to upgrade instead
    if (this.player.unitsOwned(type) >= maxNum) {
      return this.maybeUpgradeStructureType(type);
    }

    const cost = this.mg.unitInfo(type).cost(this.player);

    // Check if we can afford it while maintaining reserve
    if (this.player.gold() - cost < this.goldReserve) {
      // If we can't afford to build, maybe we can afford to upgrade existing ones
      return this.maybeUpgradeStructureType(type);
    }

    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      // If we can't find space to build, try upgrading existing ones
      return this.maybeUpgradeStructureType(type);
    }

    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      // If we can't build for other reasons, try upgrading existing ones
      return this.maybeUpgradeStructureType(type);
    }

    this.mg.addExecution(new ConstructionExecution(this.player, tile, type));
    return true;
  }

  private maybeSpawnStructureUnlimited(type: UnitType): boolean {
    if (this.player === null) return false;

    const cost = this.mg.unitInfo(type).cost(this.player);

    // Check if we can afford it while maintaining reserve
    if (this.player.gold() - cost < this.goldReserve) {
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
    if (this.player === null) return false;

    const upgradableUnits = this.player
      .units(type)
      .filter((unit) => this.mg.unitInfo(type).upgradable);

    if (upgradableUnits.length === 0) return false;

    const cost = this.mg.unitInfo(type).cost(this.player);
    // Check if we can afford it while maintaining reserve
    if (this.player.gold() - cost < this.goldReserve) return false;

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
        // For ports, calculate if upgrading would decrease spawn rate number (increase probability)
        const totalPorts = this.player!.units(UnitType.Port).length;
        const baseSpawnRate = Math.min(
          50,
          Math.round(10 * Math.pow(totalPorts, 0.6)),
        );

        const currentMultiplier = Math.pow(1.5, currentLevel - 1);
        const nextMultiplier = Math.pow(1.5, currentLevel);

        const currentSpawnRate = Math.max(
          1,
          Math.round(baseSpawnRate / currentMultiplier),
        );
        const nextSpawnRate = Math.max(
          1,
          Math.round(baseSpawnRate / nextMultiplier),
        );

        // Only beneficial if next level decreases spawn rate number (higher probability)
        // Since chance(X) means 1/X probability, lower X = higher probability
        return nextSpawnRate < currentSpawnRate;
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

  private maybeSpawnWarship(): boolean {
    if (this.player === null) return false;

    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    const cost = this.mg.unitInfo(UnitType.Warship).cost(this.player);

    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() - cost >= this.goldReserve
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
        return false;
      }
      this.mg.addExecution(
        new ConstructionExecution(this.player, targetTile, UnitType.Warship),
      );
      return true;
    }
    return false;
  }

  private maybeSpawnTrainStation(): boolean {
    if (this.player === null) return false;
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

  private structureSpawnTile(type: UnitType) {
    if (this.player === null) throw new Error("not initialized");

    // Get all territories once
    const territories = Array.from(this.player.tiles());
    if (territories.length === 0) return null;

    // Performance optimization: For large territories, sample randomly instead of checking all tiles
    const maxSamples = Math.min(territories.length, 50); // Limit to 50 tiles max
    const territoriesToCheck =
      territories.length > maxSamples
        ? this.sampleRandomTiles(territories, maxSamples)
        : territories;

    // Find buildable tiles
    const candidates = territoriesToCheck.filter((t) => {
      const canBuild = this.player!.canBuild(type, t);
      return canBuild !== false;
    });

    if (candidates.length === 0) {
      // If no candidates in sample, try a few more random tiles
      if (territories.length > maxSamples) {
        const extraSamples = this.sampleRandomTiles(territories, 20);
        const extraCandidates = extraSamples.filter((t) => {
          const canBuild = this.player!.canBuild(type, t);
          return canBuild !== false;
        });
        if (extraCandidates.length > 0) {
          return this.getRandomElement(extraCandidates);
        }
      }
      return null;
    }

    // For defensive structures, prefer border tiles
    if (type === UnitType.SAMLauncher || type === UnitType.DefensePost) {
      const borderTiles = Array.from(this.player!.borderTiles());
      const borderCandidates = candidates.filter((t) =>
        borderTiles.includes(t),
      );
      if (borderCandidates.length > 0) {
        return this.getRandomElement(borderCandidates);
      }
    }

    return this.getRandomElement(candidates);
  }

  private sampleRandomTiles<T>(array: T[], count: number): T[] {
    const result: T[] = [];
    const used = new Set<number>();

    while (result.length < count && result.length < array.length) {
      const index = this.random.nextInt(0, array.length - 1);
      if (!used.has(index)) {
        used.add(index);
        result.push(array[index]);
      }
    }

    return result;
  }

  private getRandomElement<T>(array: T[]): T {
    const index = this.random.nextInt(0, array.length - 1);
    return array[index];
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
