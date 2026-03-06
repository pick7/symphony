import axios from 'axios';
import logger from './logger.js';

export class AIClient {
  constructor(config) {
    this._config = config;
    this._client = axios.create({
      baseURL: config.aiBaseUrl,
      timeout: config.aiTurnTimeoutMs,
      headers: {
        'Authorization': `Bearer ${config.aiApiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async chatCompletion(messages, options = {}) {
    const body = {
      model: options.model || this._config.aiModel,
      messages,
      max_tokens: options.maxTokens || this._config.aiMaxTokens,
      temperature: options.temperature ?? this._config.aiTemperature,
      stream: false,
    };

    try {
      const { data } = await this._client.post('/chat/completions', body);
      const choice = data.choices?.[0];
      return {
        content: choice?.message?.content || '',
        usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        finishReason: choice?.finish_reason || 'stop',
        raw: data,
      };
    } catch (err) {
      const status = err.response?.status;
      const detail = err.response?.data?.error?.message || err.message;
      logger.error(`AI API error: status=${status} ${detail}`);
      throw new Error(`ai_api_error: ${detail}`);
    }
  }

  async runTurn(systemPrompt, userPrompt, conversationHistory = []) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userPrompt },
    ];

    const result = await this.chatCompletion(messages);
    return result;
  }
}
