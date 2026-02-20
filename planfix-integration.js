/**
 * Planfix CRM Integration Module
 *
 * Этот модуль обеспечивает интеграцию с Планфикс CRM для автоматического
 * создания задач из сессий чата и логирования всех сообщений.
 */

const https = require('https');

class PlanfixIntegration {
    constructor(config) {
        this.account = config.account; // Ваш аккаунт Планфикс
        this.apiUrl = config.apiUrl || `https://${this.account}.planfix.com/rest/`;
        this.apiToken = config.apiToken; // API токен из настроек Планфикс
        this.projectId = config.projectId; // ID проекта для создания задач
        this.enabled = config.enabled !== false;

        if (this.enabled && !this.apiToken) {
            console.warn('⚠️ Planfix API token not configured - integration disabled');
            this.enabled = false;
        }

        if (this.enabled) {
            console.log('✅ Planfix integration initialized');
            console.log(`   Account: ${this.account}`);
            console.log(`   API URL: ${this.apiUrl}`);
            console.log(`   Project: ${this.projectId}`);
        }
    }

    /**
     * Создать задачу в Планфиксе для новой сессии чата
     * @param {Object} session - Объект сессии
     * @returns {Promise<Object>} - Информация о созданной задаче
     */
    async createTaskForSession(session) {
        if (!this.enabled) {
            console.log('Planfix integration disabled - skipping task creation');
            return null;
        }

        try {
            const taskData = {
                name: `Чат: ${session.userName || `Customer${session.customerNumber}`} (${session.language})`,
                description: this._formatSessionDescription(session).replace(/\n/g, '<br>'),
                project: {
                    id: parseInt(this.projectId)
                }
            };

            const result = await this._makeRequest('POST', 'task/', taskData);

            if (result && result.id) {
                console.log(`✅ Planfix task created: ID ${result.id} for session ${session.id}`);
                return {
                    taskId: result.id,
                    taskUrl: this._getTaskUrl(result.id)
                };
            }

            return null;
        } catch (error) {
            console.error('❌ Failed to create Planfix task:', error.message);
            return null;
        }
    }

    /**
     * Добавить сообщение как комментарий к задаче
     * @param {string} taskId - ID задачи в Планфиксе
     * @param {Object} message - Объект сообщения
     * @param {string} senderInfo - Информация об отправителе
     */
    async addMessageComment(taskId, message, senderInfo) {
        if (!this.enabled || !taskId) {
            return null;
        }

        try {
            const commentData = {
                description: this._formatMessage(message, senderInfo).replace(/\n/g, '<br>'),
                recipients: undefined // Не отправлять уведомления для каждого сообщения
            };

            const result = await this._makeRequest('POST', `task/${taskId}/comments/`, commentData);

            if (result && result.id) {
                console.log(`✅ Comment added to Planfix task ${taskId}`);
                return result;
            }

            return null;
        } catch (error) {
            console.error(`❌ Failed to add comment to Planfix task ${taskId}:`, error.message);
            return null;
        }
    }

    /**
     * Обновить заголовок задачи
     * @param {string} taskId - ID задачи
     * @param {string} newName - Новый заголовок задачи
     */
    async updateTaskName(taskId, newName) {
        if (!this.enabled || !taskId) {
            console.log(`⚠️ updateTaskName skipped: enabled=${this.enabled}, taskId=${taskId}`);
            return null;
        }

        console.log(`🔄 Attempting to update Planfix task ${taskId} name to: "${newName}"`);

        try {
            // Use POST (not PATCH) - this is how Planfix API updates tasks
            const updateData = {
                name: newName
            };

            console.log(`📤 Sending POST request to task/${taskId} with data:`, JSON.stringify(updateData));
            const result = await this._makeRequest('POST', `task/${taskId}`, updateData);

            console.log(`📥 Response from Planfix:`, JSON.stringify(result));

            if (result) {
                console.log(`✅ Planfix task ${taskId} name updated to: ${newName}`);
                return result;
            }

            return null;
        } catch (error) {
            console.error(`❌ Failed to update Planfix task ${taskId} name:`, error.message);
            console.error(`❌ Full error:`, error);
            return null;
        }
    }

    /**
     * Обновить статус задачи
     * @param {string} taskId - ID задачи
     * @param {string} status - Новый статус (например, 'closed', 'completed')
     * @param {Object} additionalData - Дополнительные данные для обновления
     */
    async updateTaskStatus(taskId, status, additionalData = {}) {
        if (!this.enabled || !taskId) {
            return null;
        }

        try {
            const updateData = {
                status: status,
                ...additionalData
            };

            const result = await this._makeRequest('PATCH', `/task/${taskId}`, updateData);

            if (result) {
                console.log(`✅ Planfix task ${taskId} updated to status: ${status}`);
                return result;
            }

            return null;
        } catch (error) {
            console.error(`❌ Failed to update Planfix task ${taskId}:`, error.message);
            return null;
        }
    }

    /**
     * Добавить сводку сессии при закрытии
     * @param {string} taskId - ID задачи
     * @param {Object} session - Объект сессии
     */
    async addSessionSummary(taskId, session) {
        if (!this.enabled || !taskId) {
            return null;
        }

        try {
            const duration = this._calculateSessionDuration(session);
            const messageCount = session.messages.length;
            const summary = `
📊 **ИТОГИ СЕССИИ**

⏱️ Длительность: ${duration}
💬 Всего сообщений: ${messageCount}
👤 Клиент: ${session.userName || `Customer${session.customerNumber}`}
🌐 Язык: ${session.language}
${session.operatorMode ? '👨‍💼 Оператор подключался' : '🤖 Обработано AI'}

Сессия завершена: ${new Date().toLocaleString('ru-RU')}
            `.trim();

            return await this.addMessageComment(taskId, {
                role: 'assistant',
                content: summary,
                timestamp: new Date()
            }, 'СИСТЕМА');
        } catch (error) {
            console.error(`❌ Failed to add session summary to task ${taskId}:`, error.message);
            return null;
        }
    }

    /**
     * Форматировать описание сессии для задачи
     * @private
     */
    _formatSessionDescription(session) {
        const firstMessage = session.messages.find(m => m.role === 'user');
        return `
🆕 **НОВАЯ СЕССИЯ ЧАТА**

**ID сессии:** ${session.id}
**Клиент:** ${session.userName || `Customer${session.customerNumber}`}
**Язык:** ${session.language}
**Создана:** ${session.createdAt.toLocaleString('ru-RU')}

**Первое сообщение:**
${firstMessage ? firstMessage.content : 'Нет сообщений'}

---
Эта задача автоматически создана из чата на сайте.
Все сообщения будут логироваться как комментарии ниже.
        `.trim();
    }

    /**
     * Форматировать сообщение для комментария
     * @private
     */
    _formatMessage(message, senderInfo) {
        const timestamp = message.timestamp ?
            new Date(message.timestamp).toLocaleTimeString('ru-RU') : '';

        const icon = message.role === 'user' ? '👤' :
                     message.fromOperator ? '👨‍💼' : '🤖';

        let content = `**${icon} ${senderInfo}** | ${timestamp}\n\n${message.content}`;

        if (message.photo) {
            content += `\n\n📷 [Фото](${message.photo})`;
        }

        return content;
    }

    /**
     * Вычислить длительность сессии
     * @private
     */
    _calculateSessionDuration(session) {
        const start = session.createdAt;
        const end = new Date();
        const diffMs = end - start;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 60) {
            return `${diffMins} мин`;
        }

        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        return `${hours} ч ${mins} мин`;
    }

    /**
     * Получить URL задачи
     * @private
     */
    _getTaskUrl(taskId) {
        return `https://${this.account}.planfix.ru/task/${taskId}`;
    }

    /**
     * Выполнить HTTP запрос к API Планфикса
     * @private
     */
    async _makeRequest(method, endpoint, data = null) {
        return new Promise((resolve, reject) => {
            // Формируем полный URL
            const url = `${this.apiUrl}${endpoint}`;
            const urlObj = new URL(url);

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Accept': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(responseData);
                            resolve(parsed);
                        } catch (e) {
                            resolve({ success: true, raw: responseData });
                        }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (data) {
                req.write(JSON.stringify(data));
            }

            req.end();
        });
    }
}

module.exports = PlanfixIntegration;
