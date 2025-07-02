import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { Gold } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AttackRatioEvent } from "../../InputHandler";
import {
  SendBuildingDelegationEvent,
  SendSetTargetTroopRatioEvent,
} from "../../Transport";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private targetTroopRatio = 0.95;

  @state()
  private currentTroopRatio = 0.95;

  @state()
  private _population: number;

  @state()
  private _isVisible = false;

  @state()
  private _manpower: number = 0;

  @state()
  private _gold: Gold;

  @state()
  private _goldPerSecond: Gold;

  @state()
  private _factories: number;

  @state()
  private buildingDelegationEnabled: boolean = false;

  @state()
  private buildingDelegationReserve: number = 500000;

  private _lastPopulationIncreaseRate: number;
  private init_: boolean = false;

  private userSettings = new UserSettings();

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.2",
    );
    this.targetTroopRatio = Number(
      localStorage.getItem("settings.troopRatio") ?? "0.95",
    );
    // Read current settings from localStorage
    const enabledFromStorage = localStorage.getItem(
      "settings.buildingDelegation",
    );
    const reserveFromStorage = localStorage.getItem(
      "settings.buildingDelegationReserve",
    );

    this.buildingDelegationEnabled = enabledFromStorage === "true";
    this.buildingDelegationReserve = parseInt(
      reserveFromStorage ?? "500000",
      10,
    );

    this.init_ = true;
    this.uiState.attackRatio = this.attackRatio;
    this.currentTroopRatio = this.targetTroopRatio;
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio =
        (parseInt(
          (document.getElementById("attack-ratio") as HTMLInputElement).value,
        ) +
          event.attackRatio) /
        100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });
  }

  tick() {
    if (this.init_) {
      this.eventBus.emit(
        new SendSetTargetTroopRatioEvent(this.targetTroopRatio),
      );
      this.init_ = false;
    }

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    const popIncreaseRate = player.population() - this._population;
    if (this.game.ticks() % 5 === 0) {
      this._lastPopulationIncreaseRate = popIncreaseRate;
    }

    this._population = player.population();

    this.currentTroopRatio = player.troops() / player.population();
    this.requestUpdate();
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  onBuildingDelegationToggle() {
    this.buildingDelegationEnabled = !this.buildingDelegationEnabled;

    // Update localStorage immediately
    localStorage.setItem(
      "settings.buildingDelegation",
      this.buildingDelegationEnabled.toString(),
    );
    this.eventBus.emit(
      new SendBuildingDelegationEvent(
        this.buildingDelegationEnabled,
        this.buildingDelegationReserve,
      ),
    );
  }

  onBuildingDelegationReserveChange(newReserve: number) {
    this.buildingDelegationReserve = newReserve;
    // Update localStorage immediately
    localStorage.setItem(
      "settings.buildingDelegationReserve",
      newReserve.toString(),
    );

    this.eventBus.emit(
      new SendBuildingDelegationEvent(
        this.buildingDelegationEnabled,
        this.buildingDelegationReserve,
      ),
    );
  }

  // Convert exponential slider position (0-100) to gold value
  private sliderToGold(position: number): number {
    if (position === 0) return 0;
    // Exponential curve: gold = 50M * (position/100)^2.5
    // This gives good granularity at low end and reasonable jumps at high end
    const maxGold = 50000000;
    const normalized = position / 100;
    return Math.round(maxGold * Math.pow(normalized, 2.5));
  }

  // Convert gold value to exponential slider position (0-100)
  private goldToSlider(gold: number): number {
    if (gold === 0) return 0;
    const maxGold = 50000000;
    const normalized = gold / maxGold;
    return Math.round(100 * Math.pow(normalized, 1 / 2.5));
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  targetTroops(): number {
    return this._manpower * this.targetTroopRatio;
  }

  onTroopChange(newRatio: number) {
    this.eventBus.emit(new SendSetTargetTroopRatioEvent(newRatio));
  }

  delta(): number {
    const d = this._population - this.targetTroops();
    return d;
  }

  render() {
    return html`
      <style>
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        .targetTroopRatio::-webkit-slider-thumb {
          border-color: rgb(59 130 246);
        }
        .targetTroopRatio::-moz-range-thumb {
          border-color: rgb(59 130 246);
        }
        .attackRatio::-webkit-slider-thumb {
          border-color: rgb(239 68 68);
        }
        .attackRatio::-moz-range-thumb {
          border-color: rgb(239 68 68);
        }
        .buildingReserve::-webkit-slider-thumb {
          border-color: rgb(34 197 94);
        }
        .buildingReserve::-moz-range-thumb {
          border-color: rgb(34 197 94);
        }
      </style>
      <div
        class="${this._isVisible
          ? "text-sm lg:text-m md:w-[320px] bg-gray-800/70 p-2 pr-3 lg:p-4 shadow-lg lg:rounded-lg backdrop-blur"
          : "hidden"}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div class="relative mb-4 lg:mb-4">
          <label class="flex justify-between text-white mb-1" translate="no">
            <span>
              ${translateText("control_panel.troops")}:
              ${(this.currentTroopRatio * 100).toFixed(0)}%
            </span>
            <span>
              ${translateText("control_panel.workers")}:
              ${((1 - this.currentTroopRatio) * 100).toFixed(0)}%
            </span>
          </label>
          <div class="relative h-8">
            <!-- Background track -->
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <!-- Fill track -->
            <div
              class="absolute left-0 top-3 h-2 bg-blue-500/60 rounded transition-all duration-300"
              style="width: ${this.currentTroopRatio * 100}%"
            ></div>
            <!-- Range input - exactly overlaying the visual elements -->
            <input
              type="range"
              min="1"
              max="100"
              .value=${(this.targetTroopRatio * 100).toString()}
              @input=${(e: Event) => {
                this.targetTroopRatio =
                  parseInt((e.target as HTMLInputElement).value) / 100;
                this.onTroopChange(this.targetTroopRatio);
              }}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer targetTroopRatio"
            />
          </div>
        </div>

        <div class="relative mb-4 lg:mb-4">
          <label class="block text-white mb-1" translate="no"
            >${translateText("control_panel.attack_ratio")}:
            ${(this.attackRatio * 100).toFixed(0)}%
            (${renderTroops(
              (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
            )})</label
          >
          <div class="relative h-8">
            <!-- Background track -->
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <!-- Fill track -->
            <div
              class="absolute left-0 top-3 h-2 bg-red-500/60 rounded transition-all duration-300"
              style="width: ${this.attackRatio * 100}%"
            ></div>
            <!-- Range input - exactly overlaying the visual elements -->
            <input
              id="attack-ratio"
              type="range"
              min="1"
              max="100"
              .value=${(this.attackRatio * 100).toString()}
              @input=${(e: Event) => {
                this.attackRatio =
                  parseInt((e.target as HTMLInputElement).value) / 100;
                this.onAttackRatioChange(this.attackRatio);
              }}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer attackRatio"
            />
          </div>
        </div>

        <!-- AI Building Delegation -->
        <div class="relative mb-4 lg:mb-4 bg-black/20 p-2 rounded">
          <div class="flex items-center justify-between mb-2">
            <label class="text-white font-bold">🏗️ AI Autobuild</label>
            <button
              @click=${this.onBuildingDelegationToggle}
              class="px-2 py-1 text-xs rounded ${this.buildingDelegationEnabled
                ? "bg-green-600 text-white"
                : "bg-gray-600 text-gray-300"}"
            >
              ${this.buildingDelegationEnabled ? "ON" : "OFF"}
            </button>
          </div>

          ${this.buildingDelegationEnabled
            ? html`
                <div class="relative">
                  <label class="block text-white text-xs mb-1">
                    💰 Gold Reserve:
                    ${renderNumber(BigInt(this.buildingDelegationReserve))}
                  </label>
                  <div class="relative h-6">
                    <!-- Background track -->
                    <div
                      class="absolute left-0 right-0 top-2 h-2 bg-white/20 rounded"
                    ></div>
                    <!-- Fill track -->
                    <div
                      class="absolute left-0 top-2 h-2 bg-green-500/60 rounded transition-all duration-300"
                      style="width: ${this.goldToSlider(
                        this.buildingDelegationReserve,
                      )}%"
                    ></div>
                    <!-- Range input -->
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      .value=${this.goldToSlider(
                        this.buildingDelegationReserve,
                      ).toString()}
                      @input=${(e: Event) => {
                        const sliderPosition = parseInt(
                          (e.target as HTMLInputElement).value,
                        );
                        const goldValue = this.sliderToGold(sliderPosition);
                        this.onBuildingDelegationReserveChange(goldValue);
                      }}
                      class="absolute left-0 right-0 top-1 m-0 h-4 cursor-pointer buildingReserve"
                    />
                  </div>
                </div>
              `
            : html`<div class="text-xs text-gray-400">
                Enable to let AI manage buildings automatically
              </div>`}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
