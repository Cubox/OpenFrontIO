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

## 🤖 AI Enhancements

### Smart Building Upgrades

- **Economic Logic**: AI upgrades when it wants to build but can't (no space, at limit, can't afford)
- **Smart targeting**: Upgrades lowest level units first
- **Natural Priority**: Extended building tree (Port→City→Warship→TrainStation→Silo→Silo→Port→City→SAM→Port→City→Warship→Factory→City)
- **Natural Limits**: Same caps as human players (ports ~level 10+, others unlimited)
- **Infrastructure First**: After initial targets, heavily prioritizes building new structures (3:1 ratio) over upgrades for better expansion

### Strategic MIRV Usage

- **MIRV**: For existential threats or heavily defended targets
- **Hydrogen Bomb**: For high-value targets (100k+ score)
- **Atom Bomb**: Standard fallback

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

### Controls

- **Bottom panel toggle**: Quick enable/disable during gameplay
- **Reserve slider**: Set how much gold to keep (50k increments)
- **Real-time updates**: Changes apply immediately

## Building & Upgrades

- **Structure Upgrades**: All buildings (Port, City, Factory, MissileSilo, SAMLauncher) can be upgraded
- **Natural Limits**: Ports have natural caps when spawn rates reach minimum (~level 10+), other buildings limited by economics
- **Progressive Costs**: Each upgrade level increases both build cost and ongoing benefits
