const CONSTANTS = require('../config/constants');

/**
 * Translation utilities using Anthropic Claude
 */
class TranslationService {
    constructor(anthropicClient) {
        this.anthropic = anthropicClient;
    }

    /**
     * Translate text to Russian
     * @param {string} text - Text to translate
     * @param {string} sourceLanguage - Source language name
     * @returns {Promise<string>} - Translated text
     */
    async translateToRussian(text, sourceLanguage) {
        // Only skip translation if already in Russian
        if (sourceLanguage === 'Russian') {
            return text;
        }

        try {
            console.log(`Translating from ${sourceLanguage} to Russian: "${text.substring(0, 50)}..."`);

            const response = await this.anthropic.messages.create({
                model: CONSTANTS.ANTHROPIC_MODEL,
                max_tokens: 500,
                system: `You are a translator. Translate the following text to Russian. Only output the translation, nothing else.`,
                messages: [{
                    role: 'user',
                    content: `Translate to Russian:\n\n${text}`
                }]
            });

            const translated = response.content[0].text.trim();
            console.log(`Translation result: "${translated.substring(0, 50)}..."`);
            return translated;
        } catch (error) {
            console.error('Translation error:', error);
            return `[${sourceLanguage}] ${text}`; // Return original with language tag if translation fails
        }
    }

    /**
     * Translate text to specific target language
     * @param {string} text - Text to translate
     * @param {string} targetLanguage - Target language name
     * @returns {Promise<string>} - Translated text
     */
    async translateToLanguage(text, targetLanguage) {
        console.log(`translateToLanguage called: target=${targetLanguage}`);

        // Don't translate if user's language is Russian (same as operator)
        if (targetLanguage === 'Russian') {
            console.log(`No translation needed - user speaks Russian`);
            return text;
        }

        console.log(`Translating from Russian to ${targetLanguage}: "${text.substring(0, 50)}..."`);

        try {
            const response = await this.anthropic.messages.create({
                model: CONSTANTS.ANTHROPIC_MODEL,
                max_tokens: 500,
                system: `You are a translator. Translate the following text to ${targetLanguage}. Only output the translation, nothing else.`,
                messages: [{
                    role: 'user',
                    content: `Translate to ${targetLanguage}:\n\n${text}`
                }]
            });

            const translated = response.content[0].text.trim();
            console.log(`Translation result: "${translated.substring(0, 50)}..."`);
            return translated;
        } catch (error) {
            console.error('Translation error:', error);
            return text; // Return original if translation fails
        }
    }
}

module.exports = TranslationService;
