/** A game the shell can recognise, see `GAME_LIST` and `userData/games.json`. */
export type GameEntry = {
  id: string;
  name: string;
  /**
   * Process names that mean the game is running, matched case-insensitively.
   * On Linux the `win32` names match too, since Proton/Wine show them in the
   * command line.
   */
  executables: { win32?: string[]; linux?: string[] };
  /**
   * Processes whose windows are a launcher/client rather than the game.
   * Every other process of the entry counts as the game itself.
   */
  clients?: string[];
  /**
   * Display name by executable (case-insensitive), used instead of `name`
   * while such a process runs. Lets one entry be shown as another game, e.g.
   * Teamfight Tactics started from the League client.
   */
  gameNames?: Record<string, string>;
  /**
   * Fallback when a window can't be matched to its process: exact,
   * case-insensitive window titles per role. Only used for roles that have
   * no window yet, and only while the entry is running.
   */
  windowTitles?: { game?: string[]; client?: string[] };
};

/** Shorthand for an entry that only has Windows (and Proton) executables. */
const win = (id: string, name: string, ...exes: string[]): GameEntry => ({
  id,
  name,
  executables: { win32: exes },
});

/**
 * Games bundled with the app. Only executable names that are known to be
 * specific to the game are listed. Generic ones (javaw.exe, hl2.exe,
 * ShooterGame.exe, ...) are left out on purpose.
 */
export const GAME_LIST: GameEntry[] = [
  {
    id: "league-of-legends",
    name: "League of Legends",
    executables: {
      win32: [
        "League of Legends.exe",
        "LeagueClientUx.exe",
        // Teamfight Tactics (Unreal Engine 5): launcher stub and the game
        "TFTClient.exe",
        "TFTClient-Win64-Shipping.exe",
      ],
    },
    clients: ["LeagueClientUx.exe"],
    windowTitles: {
      game: ["League of Legends (TM) Client"],
      client: ["League of Legends"],
    },
    gameNames: {
      "TFTClient-Win64-Shipping.exe": "Teamfight Tactics",
      "TFTClient.exe": "Teamfight Tactics",
    },
  },
  win("valorant", "VALORANT", "VALORANT-Win64-Shipping.exe"),
  {
    id: "cs2",
    name: "Counter-Strike 2",
    executables: { win32: ["cs2.exe"], linux: ["cs2"] },
  },
  win("csgo", "Counter-Strike: Global Offensive", "csgo.exe"),
  {
    id: "dota2",
    name: "Dota 2",
    executables: { win32: ["dota2.exe"], linux: ["dota2"] },
  },
  win("fortnite", "Fortnite", "FortniteClient-Win64-Shipping.exe"),
  win("apex-legends", "Apex Legends", "r5apex.exe", "r5apex_dx12.exe"),
  win("overwatch", "Overwatch 2", "Overwatch.exe"),
  win("rocket-league", "Rocket League", "RocketLeague.exe"),
  win("gta-v", "Grand Theft Auto V", "GTA5.exe"),
  win("rdr2", "Red Dead Redemption 2", "RDR2.exe"),
  win("elden-ring", "Elden Ring", "eldenring.exe"),
  win("dark-souls-3", "Dark Souls III", "DarkSoulsIII.exe"),
  win("sekiro", "Sekiro: Shadows Die Twice", "sekiro.exe"),
  {
    id: "tf2",
    name: "Team Fortress 2",
    executables: { win32: ["tf_win64.exe"], linux: ["tf_linux64"] },
  },
  win("l4d2", "Left 4 Dead 2", "left4dead2.exe"),
  win("gmod", "Garry's Mod", "gmod.exe"),
  win(
    "rainbow-six-siege",
    "Rainbow Six Siege",
    "RainbowSix.exe",
    "RainbowSix_Vulkan.exe",
  ),
  win("pubg", "PUBG: Battlegrounds", "TslGame.exe"),
  win("destiny-2", "Destiny 2", "destiny2.exe"),
  win("call-of-duty", "Call of Duty", "cod.exe", "ModernWarfare.exe"),
  win("battlefield-2042", "Battlefield 2042", "BF2042.exe"),
  win("battlefield-v", "Battlefield V", "BFV.exe"),
  win("battlefield-1", "Battlefield 1", "bf1.exe"),
  win("cyberpunk-2077", "Cyberpunk 2077", "Cyberpunk2077.exe"),
  win("witcher-3", "The Witcher 3", "witcher3.exe"),
  win("baldurs-gate-3", "Baldur's Gate 3", "bg3.exe", "bg3_dx11.exe"),
  win("hogwarts-legacy", "Hogwarts Legacy", "HogwartsLegacy.exe"),
  win("palworld", "Palworld", "Palworld-Win64-Shipping.exe"),
  win("helldivers-2", "Helldivers 2", "helldivers2.exe"),
  win("lethal-company", "Lethal Company", "Lethal Company.exe"),
  win("terraria", "Terraria", "Terraria.exe"),
  win("stardew-valley", "Stardew Valley", "Stardew Valley.exe"),
  win("among-us", "Among Us", "Among Us.exe"),
  win("fall-guys", "Fall Guys", "FallGuys_client_game.exe"),
  win("genshin-impact", "Genshin Impact", "GenshinImpact.exe"),
  win("honkai-star-rail", "Honkai: Star Rail", "StarRail.exe"),
  win(
    "path-of-exile",
    "Path of Exile",
    "PathOfExile.exe",
    "PathOfExile_x64.exe",
    "PathOfExileSteam.exe",
    "PathOfExile_x64Steam.exe",
  ),
  win("diablo-4", "Diablo IV", "Diablo IV.exe"),
  win("wow", "World of Warcraft", "Wow.exe"),
  win("hearthstone", "Hearthstone", "Hearthstone.exe"),
  win("starcraft-2", "StarCraft II", "SC2_x64.exe"),
  win("warframe", "Warframe", "Warframe.x64.exe"),
  win("rust", "Rust", "RustClient.exe"),
  win("euro-truck-simulator-2", "Euro Truck Simulator 2", "eurotrucks2.exe"),
  {
    id: "factorio",
    name: "Factorio",
    executables: { win32: ["factorio.exe"], linux: ["factorio"] },
  },
  win("rimworld", "RimWorld", "RimWorldWin64.exe"),
  win("satisfactory", "Satisfactory", "FactoryGame-Win64-Shipping.exe"),
  win("sea-of-thieves", "Sea of Thieves", "SoTGame.exe"),
  win("deep-rock-galactic", "Deep Rock Galactic", "FSD-Win64-Shipping.exe"),
  win(
    "dead-by-daylight",
    "Dead by Daylight",
    "DeadByDaylight-Win64-Shipping.exe",
  ),
  win("phasmophobia", "Phasmophobia", "Phasmophobia.exe"),
  win("valheim", "Valheim", "valheim.exe"),
  win("black-desert", "Black Desert", "BlackDesert64.exe"),
  win("lost-ark", "Lost Ark", "LOSTARK.exe"),
  win("tarkov", "Escape from Tarkov", "EscapeFromTarkov.exe"),
  win("marvel-rivals", "Marvel Rivals", "Marvel-Win64-Shipping.exe"),
  win("hollow-knight", "Hollow Knight", "hollow_knight.exe"),
  win("roblox", "Roblox", "RobloxPlayerBeta.exe"),
  win("ffxiv", "Final Fantasy XIV", "ffxiv_dx11.exe"),
  win(
    "monster-hunter-world",
    "Monster Hunter: World",
    "MonsterHunterWorld.exe",
  ),
  win("monster-hunter-wilds", "Monster Hunter Wilds", "MonsterHunterWilds.exe"),
  win("ready-or-not", "Ready or Not", "ReadyOrNot-Win64-Shipping.exe"),
  {
    id: "stellaris",
    name: "Stellaris",
    executables: { win32: ["stellaris.exe"], linux: ["stellaris"] },
  },
  win("divinity-original-sin-2", "Divinity: Original Sin 2", "EoCApp.exe"),
  win("binding-of-isaac", "The Binding of Isaac", "isaac-ng.exe"),
  win("gunfire-reborn", "Gunfire Reborn", "Gunfire Reborn.exe"),
];
