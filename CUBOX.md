# Cubox Version - OpenFrontIO Modifications

This document lists all changes made to create the Cubox version of OpenFrontIO.

## 🚀 Deployment & Infrastructure

- **Ports**: Master server on 3564, workers on 3565+
- **Environment**: Set to `dev` to avoid Cloudflare setup
- **Version text**: Changed to "Cubox version"

## 🎨 UI & Branding Changes

- **Removed Discord integration**: No login/logout buttons or Discord links
- **Removed footer links**: Privacy Policy, Terms of Service, Advertise
- **Removed advertising**: All Google Ad components removed
- **Unlocked patterns**: All cosmetic patterns available without login
- **Removed public lobbies**: No automated game scheduling

## 🤖 AI & Economy Enhancements

### Smart Building Upgrades

- **Economic Logic**: AI upgrades when it wants to build but can't (no space, at limit, can't afford)
- **Smart targeting**: Upgrades lowest level units first
- **Natural Priority**: Extended building tree (Port→City→Warship→TrainStation→Silo→Silo→Port→City→SAM→Port→City→Warship→Factory→City)
- **Natural Limits**: Same caps as human players (ports ~level 10+, others unlimited)
- **Infrastructure First**: After initial targets, heavily prioritizes building new structures (3:1 ratio) over upgrades for better expansion
- **Dynamic Gold Reserve**: Reserve now scales with total building levels (each level counts as one). 1 M per 5 levels, up to 100 M.

### Strategic Nuke Usage

- **Dynamic Threat Radius**: AI relaxes safety radius when existentially threatened (15 → 5 tiles) making it more willing to strike border targets.
- **Lowered Nuke Threshold**: Trigger 'Oh-shit' nuke response sooner (territory 2×, troops 2.5×, incoming 25% of own troops).
- **Massive Retaliation**: If incoming invasion > 2× our troops, AI fires every ready silo until gold can't afford cheapest nuke.
- **Attack-Triggered Nukes**: If no high-value target is found while under heavy attack, AI will nuke the center of the largest incoming army.
- **MIRV**: For existential threats or heavily defended targets
- **Hydrogen Bomb**: For high-value targets (100k+ score)
- **Atom Bomb**: Standard fallback

### Trade Economy Balancing

- **Trade Ship Spawn**: Halved spawn rate for ports to reduce late-game lag (spawn rate multiplier from 10 → 5).
- **Trade Income**: Doubled base gold earned per trade ship to compensate for reduced frequency.

## 🏗 Building Upgrade System

### New Upgrade Benefits

- **SAM Launchers**: +10% range per level (Level 3 = 96.8 range)
- **Ports**: +10% trade revenue per level (instead of more ships to reduce lag)
- **Factories**: +5% gold income per level
- **Defense Posts**: No longer upgradeable (prevents resource waste)

## 🤖 AI Autobuild for Players

### Core Feature

- **Toggle ON/OFF**: Let AI manage your buildings while you focus on warfare
- **Gold Reserve**: AI only spends above your set amount (0-50M gold)
- **Extended Building**: Uses expanded AI algorithm (Port→City→Warship→TrainStation→Silo→Silo→Port→City→SAM→Port→City→Factory→City)
- **Infrastructure First**: After initial targets, heavily prioritizes building new structures over upgrades for better expansion
- **Unlimited Expansion**: No building limits for late game growth

### **MAJOR UPDATE: Client-Side Architecture**

- **No More Desyncs**: Moved from server-side to client-side processing
- **Intent-Based**: Uses same building system as human players (BuildUnitIntentEvent)
- **Client Randomness**: Random decisions don't affect server game state
- **Persistent Settings**: Automatically saved in localStorage and restored
- **Clean Codebase**: Removed all server-side delegation files and references

### Controls

- **Bottom panel toggle**: Quick enable/disable during gameplay
- **Reserve slider**: Set how much gold to keep (50k increments)
- **Real-time updates**: Changes apply immediately
- **Automatic persistence**: Settings saved between game sessions

## Building & Upgrades

- **Structure Upgrades**: All buildings (Port, City, Factory, MissileSilo, SAMLauncher) can be upgraded
- **Natural Limits**: Ports have natural caps when spawn rates reach minimum (~level 10+), other buildings limited by economics
- **Progressive Costs**: Each upgrade level increases both build cost and ongoing benefits

## Bug Fixes

- **Client Autobuild Crash**: Fixed cost() functions calling unitsConstructed() on PlayerView - added helper function to count units for both Player and PlayerView types
