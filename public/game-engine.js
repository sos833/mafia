// الملف: public/game-engine.js

/**
 * يدير كامل حالة ومنطق لعبة المافيا في وضع الأوفلاين.
 * يعمل بمثابة "الخادم" أو "حكم اللعبة" الذي يتم تشغيله في متصفح المستخدم.
 */
class OfflineGameManager {
    /**
     * يقوم بتهيئة لعبة أوفلاين جديدة.
     * @param {string[]} playerNames - مصفوفة بأسماء جميع اللاعبين (البشري + البوتات).
     * @param {string} humanPlayerName - اسم اللاعب البشري.
     * @param {object} settings - إعدادات اللعبة، وبشكل أساسي تكوين الأدوار.
     */
    constructor(playerNames, humanPlayerName, settings) {
        this.gameState = {
            players: playerNames.map(name => ({
                name: name,
                isAlive: true,
                isHuman: name === humanPlayerName
            })),
            roles: {}, // سيقوم بربط أسماء اللاعبين بكائنات أدوارهم
            phase: 'SETUP', // المرحلة الحالية للعبة: SETUP, NIGHT, DAY, VOTING
            dayCount: 1,
            settings: settings,
            gameOver: false,
            winner: null
        };
    }

    /**
     * يقوم بتعيين الأدوار لجميع اللاعبين بشكل عشوائي بناءً على إعدادات اللعبة.
     * هذه إحدى أولى الدوال التي يتم استدعاؤها بعد إنشاء اللعبة.
     */
    assignRoles() {
        let rolesToAssign = [];
        const roleSettings = this.gameState.settings.roles;

        // إنشاء مصفوفة من سلاسل الأدوار بناءً على الأعداد المحددة
        for (const role in roleSettings) {
            for (let i = 0; i < roleSettings[role]; i++) {
                rolesToAssign.push(role);
            }
        }
        
        // خلط مصفوفة الأدوار لضمان العشوائية
        rolesToAssign.sort(() => Math.random() - 0.5);

        // تعيين دور لكل لاعب وتخزين تفاصيله
        this.gameState.players.forEach((player, index) => {
            const roleName = rolesToAssign[index] || 'مواطن'; // الافتراضي هو مواطن إذا نفدت الأدوار
            const descriptions = {
                'المافيا': 'أنت القاتل. في الليل، اختر ضحية لقتلها.',
                'المحقق': 'أنت الحقيقة. في الليل، اختر شخصًا لكشف هويته.',
                'الطبيب': 'أنت المنقذ. في الليل، اختر شخصًا لحمايته من المافيا.',
                'مواطن': 'أنت بريء. استخدم ذكاءك في النهار لكشف المافيا.'
            };
            const icon = roleName === 'المافيا' ? '🔪' : roleName === 'المحقق' ? '🕵️‍♂️' : roleName === 'الطبيب' ? '👨‍⚕️' : '👤';

            this.gameState.roles[player.name] = { 
                title: roleName, 
                icon: icon, 
                description: descriptions[roleName] 
            };
        });
        
        console.log("الأدوار تم توزيعها (أوفلاين):", this.gameState.roles);
    }

    /**
     * يعالج الإجراءات التي حدثت خلال الليل ويحدد النتيجة.
     * @param {object} actions - كائن يحتوي على قرارات اللاعبين (مثل mafiaTarget, doctorSave).
     * @returns {{victimName: string|null, investigationResult: {investigator: string, target: string, isMafia: boolean}|null}} - كائن يحتوي على اسم الضحية (إن وجد) ونتيجة التحقيق (إن وجدت).
     */
    processNightResults(actions) {
        const { mafiaTarget, doctorSave, detectiveTarget } = actions;
        let investigationResult = null;

        // تحديد الضحية
        const victimName = (mafiaTarget && mafiaTarget !== doctorSave) ? mafiaTarget : null;

        if (victimName) {
            const victim = this.gameState.players.find(p => p.name === victimName);
            if (victim) {
                victim.isAlive = false;
            }
        }

        // تحديد نتيجة التحقيق
        if (detectiveTarget) {
            const investigator = this.gameState.players.find(p => p.isAlive && this.gameState.roles[p.name].title === 'المحقق');
            const targetRole = this.gameState.roles[detectiveTarget].title;
            investigationResult = {
                investigator: investigator ? investigator.name : null,
                target: detectiveTarget,
                isMafia: targetRole === 'المافيا'
            };
        }

        return { victimName, investigationResult };
    }

    /**
     * يعالج الأصوات من مرحلة النهار ويحدد من تم إقصاؤه.
     * @param {object} votes - كائن يربط كل مُصوِّت باللاعب الذي تم التصويت ضده.
     * @returns {{eliminatedPlayer: string|null, tied: boolean}} - اللاعب الذي تم إقصاؤه أو معلومات عن التعادل.
     */
    processVotingResults(votes) {
        const voteCounts = {};
        Object.values(votes).forEach(votedFor => {
            if (votedFor) { // تجاهل الأصوات الفارغة
                voteCounts[votedFor] = (voteCounts[votedFor] || 0) + 1;
            }
        });

        let maxVotes = 0;
        let playerToEliminate = null;
        let tie = false;

        for (const playerName in voteCounts) {
            if (voteCounts[playerName] > maxVotes) {
                maxVotes = voteCounts[playerName];
                playerToEliminate = playerName;
                tie = false;
            } else if (voteCounts[playerName] === maxVotes && maxVotes > 0) {
                tie = true;
            }
        }

        if (tie) {
            playerToEliminate = null; // لا يتم إقصاء أحد في حالة التعادل
        }
        
        if (playerToEliminate) {
            const eliminated = this.gameState.players.find(p => p.name === playerToEliminate);
            if (eliminated) {
                eliminated.isAlive = false;
            }
        }

        return { eliminatedPlayer: playerToEliminate, tied: tie };
    }

    /**
     * يتحقق مما إذا كان قد تم الوصول إلى شرط الفوز لأحد الفريقين.
     * @returns {boolean} - إرجاع `true` إذا انتهت اللعبة، و `false` بخلاف ذلك.
     */
    checkWinCondition() {
        const alivePlayers = this.gameState.players.filter(p => p.isAlive);
        const aliveMafia = alivePlayers.filter(p => this.gameState.roles[p.name].title === 'المافيا');
        const aliveCitizens = alivePlayers.length - aliveMafia.length;

        if (aliveMafia.length === 0) {
            this.gameState.gameOver = true;
            this.gameState.winner = 'المواطنين';
            return true;
        }

        if (aliveMafia.length >= aliveCitizens) {
            this.gameState.gameOver = true;
            this.gameState.winner = 'المافيا';
            return true;
        }

        return false;
    }
}