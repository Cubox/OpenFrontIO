import { Game, PlayerType } from "../game/Game";
import { GameID } from "../Schemas";
import { DelegatedBuildingExecution } from "./DelegatedBuildingExecution";

export class DelegationManager {
  private delegationExecutions = new Map<string, DelegatedBuildingExecution>();

  constructor(
    private game: Game,
    private gameID: GameID,
  ) {}

  // Initialize delegation for all human players
  init() {
    const humanPlayers = this.game
      .allPlayers()
      .filter((p) => p.type() === PlayerType.Human);

    for (const player of humanPlayers) {
      const playerId = player.id();
      const delegation = new DelegatedBuildingExecution(
        this.gameID,
        playerId,
        500000, // Default reserve
        false, // Disabled by default
      );

      this.delegationExecutions.set(playerId, delegation);
      this.game.addExecution(delegation);
    }
  }

  // Update delegation settings for a player
  updatePlayerDelegation(
    playerId: string,
    goldReserve: number,
    enabled: boolean,
  ) {
    const delegation = this.delegationExecutions.get(playerId);
    if (delegation) {
      delegation.updateSettings(goldReserve, enabled);
    }
  }

  // Get delegation execution for a player
  getDelegation(playerId: string): DelegatedBuildingExecution | undefined {
    return this.delegationExecutions.get(playerId);
  }

  // Update settings from localStorage for a player
  updateFromUserSettings(playerId: string) {
    if (typeof localStorage === "undefined") return;

    const enabled =
      localStorage.getItem("settings.buildingDelegation") === "true";
    const reserveStr = localStorage.getItem(
      "settings.buildingDelegationReserve",
    );
    const goldReserve = reserveStr ? parseInt(reserveStr, 10) : 500000;

    this.updatePlayerDelegation(playerId, goldReserve, enabled);
  }

  // Update all human players' delegation settings from localStorage
  updateAllFromUserSettings() {
    if (typeof localStorage === "undefined") {
      return;
    }

    const enabledValue = localStorage.getItem("settings.buildingDelegation");
    const reserveStr = localStorage.getItem(
      "settings.buildingDelegationReserve",
    );

    const enabled = enabledValue === "true";
    const goldReserve = reserveStr ? parseInt(reserveStr, 10) : 500000;

    // Update all human players
    for (const [playerId, delegation] of this.delegationExecutions) {
      delegation.updateSettings(goldReserve, enabled);
    }
  }

  // Update all human players' delegation settings from direct parameters (used in Web Worker)
  updateAllFromDirectSettings(enabled: boolean, goldReserve: number) {
    // Update all human players
    for (const [playerId, delegation] of this.delegationExecutions) {
      delegation.updateSettings(goldReserve, enabled);
    }
  }
}
