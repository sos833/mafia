// الملف: public/ai-logic.js

/**
 * يمثل لاعبًا يتم التحكم فيه بواسطة الذكاء الاصطناعي (بوت).
 * يحتوي هذا الصنف على المنطق الذي يستخدمه البوت لاتخاذ القرارات خلال اللعبة.
 */
class AIBot {
    /**
     * @param {string} name - اسم البوت.
     * @param {object} role - كائن الدور الخاص بالبوت (يحتوي على title, icon, description).
     */
    constructor(name, role) {
        this.name = name;
        this.role = role;
        // يمكن إضافة ذاكرة للبوت هنا مستقبلاً لتطوير ذكائه
        // مثال: this.memory = { suspectedPlayers: [] };
    }

    /**
     * يقرر الإجراء الذي سيتخذه البوت خلال مرحلة الليل.
     * @param {object} gameState - الحالة الحالية للعبة من OfflineGameManager.
     * @returns {string|null} - اسم اللاعب المستهدف أو null إذا لم يكن هناك إجراء.
     */
    makeNightDecision(gameState) {
        // قائمة بجميع اللاعبين الأحياء
        const alivePlayers = gameState.players.filter(p => p.isAlive);
        // قائمة باللاعبين الآخرين الذين يمكن للبوت استهدافهم (ليس نفسه)
        const otherAlivePlayers = alivePlayers.filter(p => p.name !== this.name);

        // إذا لم يكن هناك أي شخص آخر على قيد الحياة، لا تفعل شيئًا
        if (otherAlivePlayers.length === 0) return null;

        // منطق اتخاذ القرار بناءً على الدور
        switch (this.role.title) {
            case 'المافيا':
                // استهدف لاعبًا عشوائيًا ليس من المافيا
                const potentialVictims = otherAlivePlayers.filter(p => gameState.roles[p.name].title !== 'المافيا');
                // حالة نادرة: إذا كان كل من تبقى على قيد الحياة من المافيا، لا تفعل شيئًا
                if (potentialVictims.length === 0) return null;
                return potentialVictims[Math.floor(Math.random() * potentialVictims.length)].name;

            case 'الطبيب':
                // قم بحماية لاعب حي عشوائي (يمكن أن يكون نفسه)
                return alivePlayers[Math.floor(Math.random() * alivePlayers.length)].name;

            case 'المحقق':
                // قم بالتحقيق مع لاعب حي عشوائي (لا يمكن أن يكون نفسه)
                return otherAlivePlayers[Math.floor(Math.random() * otherAlivePlayers.length)].name;

            default:
                // المواطنون لا يفعلون شيئًا في الليل
                return null;
        }
    }

    /**
     * يقرر من سيصوت ضده البوت خلال مرحلة النهار.
     * @param {object} gameState - الحالة الحالية للعبة.
     * @returns {string|null} - اسم اللاعب الذي سيصوت ضده.
     */
    makeVoteDecision(gameState) {
        // قائمة باللاعبين الآخرين الذين يمكن للبوت التصويت ضدهم (ليس نفسه)
        const otherAlivePlayers = gameState.players.filter(p => p.isAlive && p.name !== this.name);
        
        // إذا لم يكن هناك أحد آخر للتصويت ضده، لا تفعل شيئًا
        if (otherAlivePlayers.length === 0) return null;

        // حاليًا، الذكاء الاصطناعي بسيط: يصوت على لاعب عشوائي.
        // يمكن تحسين هذا لاحقًا بمنطق أكثر تعقيدًا.
        return otherAlivePlayers[Math.floor(Math.random() * otherAlivePlayers.length)].name;
    }
}