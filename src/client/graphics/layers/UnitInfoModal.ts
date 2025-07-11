import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { UnitType } from "../../../core/game/Game";
import { GameView, UnitView } from "../../../core/game/GameView";
import {
  SendCreateTrainStationIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
import { Layer } from "./Layer";
import { StructureLayer } from "./StructureLayer";

@customElement("unit-info-modal")
export class UnitInfoModal extends LitElement implements Layer {
  @property({ type: Boolean }) open = false;
  @property({ type: Number }) x = 0;
  @property({ type: Number }) y = 0;
  @property({ type: Object }) unit: UnitView | null = null;

  public game: GameView;
  public structureLayer: StructureLayer | null = null;
  private eventBus: EventBus;

  constructor() {
    super();
  }

  init() {}

  tick() {
    if (this.unit) {
      this.requestUpdate();
    }
  }

  public onOpenStructureModal = ({
    eventBus,
    unit,
    x,
    y,
    tileX,
    tileY,
  }: {
    eventBus: EventBus;
    unit: UnitView;
    x: number;
    y: number;
    tileX: number;
    tileY: number;
  }) => {
    if (!this.game) return;
    this.x = x;
    this.y = y;
    this.eventBus = eventBus;
    const targetRef = this.game.ref(tileX, tileY);

    const allUnitTypes = Object.values(UnitType);
    const matchingUnits = this.game.nearbyUnits(
      targetRef,
      10,
      allUnitTypes,
      ({ unit }) => unit.isActive(),
    );

    if (matchingUnits.length > 0) {
      matchingUnits.sort((a, b) => a.distSquared - b.distSquared);
      this.unit = matchingUnits[0].unit;
    } else {
      this.unit = null;
    }
    this.open = this.unit !== null;
  };

  public onCloseStructureModal = () => {
    this.open = false;
    this.unit = null;
  };

  connectedCallback() {
    super.connectedCallback();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private buildUnitTypeTranslationString(): string {
    if (!this.unit) return "unit_type.unknown"; // fallback stays the same
    const unitType = this.unit.type().toLowerCase().replace(/\s+/g, "_");
    return `unit_type.${unitType}`;
  }

  static styles = css`
    :host {
      position: fixed;
      pointer-events: none;
      z-index: 1000;
    }

    .modal {
      pointer-events: auto;
      background: rgba(30, 30, 30, 0.95);
      color: #f8f8f8;
      border: 1px solid #555;
      padding: 12px 18px;
      border-radius: 8px;
      min-width: 220px;
      max-width: 300px;
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.5);
      font-family: "Segoe UI", sans-serif;
      font-size: 15px;
      line-height: 1.6;
      backdrop-filter: blur(6px);
      position: relative;
    }

    .modal strong {
      color: #e0e0e0;
    }

    .close-button {
      background: #d00;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      padding: 6px 12px;
    }

    .close-button:hover {
      background: #a00;
    }

    .upgrade-button {
      background: #3a0;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      padding: 6px 12px;
    }

    .upgrade-button:hover {
      background: #0a0;
    }
  `;

  render() {
    if (!this.unit) return null;

    const ticksLeftInCooldown = this.unit.ticksLeftInCooldown();
    let configTimer;
    switch (this.unit.type()) {
      case UnitType.MissileSilo:
        configTimer = this.game.config().SiloCooldown();
        break;
      case UnitType.SAMLauncher:
        configTimer = this.game.config().SAMCooldown();
        break;
    }
    let cooldown = 0;
    if (ticksLeftInCooldown !== undefined && configTimer !== undefined) {
      cooldown = configTimer - (this.game.ticks() - ticksLeftInCooldown);
    }
    const secondsLeft = Math.ceil(cooldown / 10);

    // Check if upgrade would be beneficial
    const isUpgradeBeneficial = this.isUpgradeBeneficial();

    return html`
      <div
        class="modal"
        style="display: ${this.open ? "block" : "none"}; left: ${this
          .x}px; top: ${this.y}px; position: absolute;"
      >
        <div style="margin-bottom: 8px; font-size: 16px; font-weight: bold;">
          ${translateText("unit_info_modal.structure_info")}
        </div>
        <div style="margin-bottom: 4px;">
          <strong>${translateText("unit_info_modal.type")}:</strong>
          ${translateText(this.buildUnitTypeTranslationString()) ??
          translateText("unit_info_modal.unit_type_unknown")}
          <strong
            style="display: ${this.game.unitInfo(this.unit.type()).upgradable
              ? "inline"
              : "none"};"
            >${translateText("unit_info_modal.level")}:</strong
          >
          ${this.game.unitInfo(this.unit.type()).upgradable &&
          this.unit.level?.()
            ? this.unit.level?.()
            : ""}
        </div>
        ${secondsLeft > 0
          ? html`<div style="margin-bottom: 4px;">
              <strong>${translateText("unit_info_modal.cooldown")}</strong>
              ${secondsLeft}s
            </div>`
          : ""}
        <div
          style="margin-top: 14px; display: flex; justify-content: space-between;"
        >
          <button
            @click=${() => {
              if (this.unit) {
                this.eventBus.emit(
                  new SendUpgradeStructureIntentEvent(
                    this.unit.id(),
                    this.unit.type(),
                  ),
                );
              }
            }}
            class="upgrade-button"
            title="${!isUpgradeBeneficial
              ? "Max level reached - further upgrades provide no benefit"
              : translateText("unit_info_modal.upgrade")}"
            style="width: 100px; height: 32px; display: ${this.game.unitInfo(
              this.unit.type(),
            ).upgradable
              ? "block"
              : "none"}; ${!isUpgradeBeneficial
              ? "opacity: 0.5; cursor: not-allowed;"
              : ""}"
            ?disabled=${!isUpgradeBeneficial}
          >
            ${translateText("unit_info_modal.upgrade")}
          </button>
          <button
            @click=${() => {
              if (this.unit) {
                this.eventBus.emit(
                  new SendCreateTrainStationIntentEvent(this.unit.id()),
                );
                this.onCloseStructureModal();
                if (this.structureLayer) {
                  this.structureLayer.unSelectStructureUnit();
                }
              }
            }}
            class="upgrade-button"
            title="${translateText("unit_info_modal.create_station")}"
            style="width: 100px; height: 32px;
              display: ${this.game.config().isUnitDisabled(UnitType.Train) ||
            this.unit.hasTrainStation() ||
            !this.game.unitInfo(this.unit.type()).canBuildTrainStation
              ? "none"
              : "block"};"
          >
            ${translateText("unit_info_modal.create_station")}
          </button>
          <button
            @click=${() => {
              this.onCloseStructureModal();
              if (this.structureLayer) {
                this.structureLayer.unSelectStructureUnit();
              }
            }}
            class="close-button"
            title="${translateText("unit_info_modal.close")}"
            style="width: 100px; height: 32px;"
          >
            ${translateText("unit_info_modal.close")}
          </button>
        </div>
      </div>
    `;
  }

  private isUpgradeBeneficial(): boolean {
    if (!this.unit) return false;

    const currentLevel = this.unit.level();
    const unitType = this.unit.type();

    switch (unitType) {
      case UnitType.Port: {
        // For ports, calculate if upgrading would decrease spawn rate number (increase probability)
        const totalPorts = this.game.units(UnitType.Port).length;
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
}
