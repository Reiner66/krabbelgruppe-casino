// Die 30 Bot-Legenden der Krabbelgruppe
const BOT_NAMES = [
    "Dinkel Dörte", "König Dieter", "Kaiser Gökhan", "Prinz John", "F.C. Seyffetin",
    "Kontent Aytikin", "Susanne Klickerklacker", "Ali-Bernd", "Susi Sorglos", "Claire Grube",
    "Axel Schweiss", "Kniffel Knut", "Hektik Hamza", "Macker Manfred", "Würfel Wendy",
    "Bluffer Bärbel", "Poker Pascal", "Chefin Sika", "All-In Ahmet", "Schmu Schantall",
    "Daddel Dennis", "Captain Olli", "Baron Bruno", "Risiko Reiko", "Jackpot Jacqueline",
    "Mau-Mau Murat", "Briten Chrissi", "Flunkert Friedhelm", "Zocker Heiko", "Hektik Claudia"
];

// Gibt einem Bot seine Coins fürs Spiel (mindestens 12, maximal 20)
function getRandomBotCoins() {
    return Math.floor(Math.random() * (20 - 12 + 1)) + 12;
}

// Wenn ein Bot gewinnt, wird über 20 Coins für das Casino abgeschöpft
function handleBotWin(currentCoins, winAmount) {
    let total = currentCoins + winAmount;
    if (total > 20) {
        console.log(`[Casino-Steuer] Ein Bot hatte ${total} Coins. Über 20 Coins wird abgeschöpft!`);
        return 20; // Guthaben wird gekappt, der Rest geht ans Casino
    }
    return total;
}

module.exports = {
    BOT_NAMES,
    getRandomBotCoins,
    handleBotWin
};
