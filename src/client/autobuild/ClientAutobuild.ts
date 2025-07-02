import { EventBus } from "../../core/EventBus";
import { Cell, Gold, UnitType } from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { GameView, PlayerView } from "../../core/game/GameView";
import {
  BuildUnitIntentEvent,
  SendCreateTrainStationIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";

export class ClientAutobuild {
  private enabled = false;
  private goldReserve: Gold = 500000n;
  private lastBuildTick = 0;
  private buildInterval = 10; // Build every 10 ticks (1 second)

  constructor(
    private eventBus: EventBus,
    private game: GameView,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setGoldReserve(reserve: number) {
    this.goldReserve = BigInt(reserve);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getGoldReserve(): number {
    return Number(this.goldReserve);
  }

  tick() {
    if (!this.enabled || this.game.inSpawnPhase()) {
      return;
    }

    const player = this.game.myPlayer();
    if (!player || !player.isAlive()) {
      return;
    }

    // Only build every buildInterval ticks
    const currentTick = this.game.ticks();
    if (currentTick - this.lastBuildTick < this.buildInterval) {
      return;
    }

    // Only build if we have more gold than reserve
    if (player.gold() <= this.goldReserve) {
      return;
    }

    // Try to build/upgrade in priority order (matches original server logic)
    if (this.handleBuilding(player)) {
      this.lastBuildTick = currentTick;
    }
  }

  private handleBuilding(player: PlayerView): boolean {
    // Phase 1: Essential buildings first (exact same order as server)
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 1)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.City, 1)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.MissileSilo, 1)) return true;
    if (this.maybeSpawnWarship()) return true;
    if (this.maybeSpawnTrainStation()) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.MissileSilo, 1)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.MissileSilo, 2)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 2)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.City, 3)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.SAMLauncher, 1)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.Port, 3)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.City, 4)) return true;
    if (this.maybeSpawnWarship()) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.Factory, 1)) return true;
    if (this.maybeSpawnStructurePhase1(UnitType.City, 5)) return true;

    // Phase 2: Expansion (using same random actions as server but client can be random)
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

    // Shuffle randomly on client (client can be non-deterministic)
    const shuffled = [...expansionActions].sort(() => Math.random() - 0.5);

    for (const action of shuffled) {
      if (action.type === "build") {
        if (this.maybeSpawnStructureUnlimited(action.unitType)) return true;
      } else if (action.type === "upgrade") {
        if (this.maybeUpgradeStructureType(action.unitType)) return true;
      }
    }

    return false;
  }

  private maybeSpawnStructurePhase1(type: UnitType, maxNum: number): boolean {
    const player = this.game.myPlayer();
    if (!player) return false;

    // Count units of this type (including construction)
    const ownedCount = this.countUnitsOwned(type);
    if (ownedCount >= maxNum) {
      return false;
    }

    return this.tryBuildStructure(type);
  }

  private maybeSpawnStructureUnlimited(type: UnitType): boolean {
    return this.tryBuildStructure(type);
  }

  private tryBuildStructure(type: UnitType): boolean {
    const player = this.game.myPlayer();
    if (!player) return false;

    const cost = this.game.unitInfo(type).cost(player);
    if (player.gold() - cost < this.goldReserve) {
      return false;
    }

    const tile = this.findBuildTile(type);
    if (!tile) return false;

    // Check if we can build using same logic as server
    const canBuild = this.canBuildAt(type, tile);
    if (!canBuild) return false;

    // Send build intent like a human clicking
    this.eventBus.emit(
      new BuildUnitIntentEvent(
        type,
        new Cell(this.game.x(tile), this.game.y(tile)),
      ),
    );
    return true;
  }

  private maybeUpgradeStructureType(type: UnitType): boolean {
    const player = this.game.myPlayer();
    if (!player) return false;

    const upgradableUnits = player
      .units(type)
      .filter((unit) => this.game.unitInfo(type).upgradable);

    if (upgradableUnits.length === 0) return false;

    const cost = this.game.unitInfo(type).cost(player);
    if (player.gold() - cost < this.goldReserve) return false;

    // Find lowest level unit to upgrade (matching server logic)
    let bestCandidate = upgradableUnits[0];
    for (const unit of upgradableUnits) {
      if (
        this.isUpgradeBeneficial(unit) &&
        (!this.isUpgradeBeneficial(bestCandidate) ||
          unit.level() < bestCandidate.level())
      ) {
        bestCandidate = unit;
      }
    }

    if (!this.isUpgradeBeneficial(bestCandidate)) return false;

    // Send upgrade intent like a human clicking
    this.eventBus.emit(
      new SendUpgradeStructureIntentEvent(
        bestCandidate.id(),
        bestCandidate.type(),
      ),
    );
    return true;
  }

  private maybeSpawnWarship(): boolean {
    const player = this.game.myPlayer();
    if (!player) return false;

    const ports = player.units(UnitType.Port);
    const ships = player.units(UnitType.Warship);
    const cost = this.game.unitInfo(UnitType.Warship).cost(player);

    if (
      ports.length > 0 &&
      ships.length === 0 &&
      player.gold() - cost >= this.goldReserve
    ) {
      // Random selection like server (client can be random)
      if (Math.random() > 0.5) return false;

      const port = ports[Math.floor(Math.random() * ports.length)];
      const spawnTile = this.findWarshipSpawnTile(port.tile());
      if (!spawnTile) return false;

      const canBuild = this.canBuildAt(UnitType.Warship, spawnTile);
      if (!canBuild) return false;

      this.eventBus.emit(
        new BuildUnitIntentEvent(
          UnitType.Warship,
          new Cell(this.game.x(spawnTile), this.game.y(spawnTile)),
        ),
      );
      return true;
    }
    return false;
  }

  private maybeSpawnTrainStation(): boolean {
    const player = this.game.myPlayer();
    if (!player) return false;

    const citiesWithoutStations = player.units().filter((unit) => {
      switch (unit.type()) {
        case UnitType.City:
        case UnitType.Port:
        case UnitType.Factory:
          return !unit.hasTrainStation();
        default:
          return false;
      }
    });

    if (citiesWithoutStations.length === 0) return false;

    this.eventBus.emit(
      new SendCreateTrainStationIntentEvent(citiesWithoutStations[0].id()),
    );
    return true;
  }

  private isUpgradeBeneficial(unit: any): boolean {
    // All upgrades are beneficial (matching server logic after revert)
    return true;
  }

  private countUnitsOwned(type: UnitType): number {
    const player = this.game.myPlayer();
    if (!player) return 0;

    // Count both actual units and construction units building this type
    let count = player.units(type).length;

    // Add construction units that will become this type
    const constructionUnits = player.units(UnitType.Construction);
    for (const unit of constructionUnits) {
      const constructionType = unit.constructionType();
      if (constructionType === type) {
        count++;
      }
    }

    return count;
  }

  private canBuildAt(type: UnitType, tile: TileRef): boolean {
    const player = this.game.myPlayer();
    if (!player) return false;

    // Simple check - in a real implementation this would check all the server logic
    // For now, just check basic conditions
    if (!player.isAlive()) return false;

    const cost = this.game.unitInfo(type).cost(player);
    if (player.gold() < cost) return false;

    // Check if tile is owned by player
    const owner = this.game.owner(tile);
    if (!owner || !owner.isPlayer() || owner.id() !== player.id()) {
      return false;
    }

    return true;
  }

  private findBuildTile(type: UnitType): TileRef | null {
    const player = this.game.myPlayer();
    if (!player) return null;

    // Use random sampling like original server (client can be random)
    const territories: TileRef[] = [];

    // Get player territories - since PlayerView doesn't have tiles(),
    // we'll search the map for tiles owned by this player
    for (let x = 0; x < this.game.width(); x++) {
      for (let y = 0; y < this.game.height(); y++) {
        const tile = this.game.ref(x, y);
        const owner = this.game.owner(tile);
        if (owner && owner.isPlayer() && owner.id() === player.id()) {
          territories.push(tile);
        }
      }
    }

    if (territories.length === 0) return null;

    // Random sampling like server
    const maxSamples = Math.min(territories.length, 50);
    const samplesToCheck: TileRef[] = [];
    const used = new Set<number>();

    while (
      samplesToCheck.length < maxSamples &&
      samplesToCheck.length < territories.length
    ) {
      const index = Math.floor(Math.random() * territories.length);
      if (!used.has(index)) {
        used.add(index);
        samplesToCheck.push(territories[index]);
      }
    }

    // Find first valid candidate
    for (const tile of samplesToCheck) {
      if (this.canBuildAt(type, tile)) {
        return tile;
      }
    }

    return null;
  }

  private findWarshipSpawnTile(portTile: TileRef): TileRef | null {
    const radius = 250;
    const portX = this.game.x(portTile);
    const portY = this.game.y(portTile);

    // Random search like server
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = portX + Math.floor(Math.random() * (radius * 2)) - radius;
      const randY = portY + Math.floor(Math.random() * (radius * 2)) - radius;

      if (!this.game.isValidCoord(randX, randY)) continue;

      const tile = this.game.ref(randX, randY);
      if (this.game.isOcean(tile)) {
        return tile;
      }
    }
    return null;
  }
}
