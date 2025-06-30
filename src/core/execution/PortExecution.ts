import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private port: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }
    if (this.port === null) {
      const tile = this.tile;
      const spawn = this.player.canBuild(UnitType.Port, tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player.id()} cannot build port at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.port = this.player.buildUnit(UnitType.Port, spawn, {});
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.port.owner().id()) {
      this.player = this.port.owner();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    const totalNbOfPorts = this.mg.units(UnitType.Port).length;
    // 1.5x trade ship spawn rate per level (divide by multiplier since chance(X) = 1/X probability)
    const levelMultiplier = Math.pow(1.5, this.port.level() - 1);
    const baseSpawnRate = this.mg.config().tradeShipSpawnRate(totalNbOfPorts);
    const adjustedSpawnRate = Math.max(
      1,
      Math.round(baseSpawnRate / levelMultiplier),
    );

    if (!this.random.chance(adjustedSpawnRate)) {
      return;
    }

    const ports = this.player.tradingPorts(this.port);

    if (ports.length === 0) {
      return;
    }

    const port = this.random.randElement(ports);
    this.mg.addExecution(new TradeShipExecution(this.player, this.port, port));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
