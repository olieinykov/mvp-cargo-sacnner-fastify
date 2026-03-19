import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;

let anthropicInstance = null;
if (apiKey) {
	anthropicInstance = new Anthropic({ apiKey });
}

export const anthropic = anthropicInstance;

export const requireAnthropic = () => {
	if (!anthropicInstance) {
		throw new Error('ANTHROPIC_API_KEY is not set');
	}

	return anthropicInstance;
};
