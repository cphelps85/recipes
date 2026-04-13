const PARSE_PROMPT = `Parse this recipe and return ONLY a valid JSON object with this exact structure, no other text, no markdown:
{
  "title": "Recipe Title",
  "desc": "One sentence description of the dish",
  "tags": ["beef"],
  "servings": 4,
  "ingredients": [
    { "name": "Ingredient name", "amount": 1, "unit": "cup" }
  ],
  "steps": [
    { "title": "Step title", "text": "Full step description" }
  ],
  "notes": "Any tips or notes, or empty string if none"
}

Rules:
- tags must only use these values: beef, chicken, pork, veggie, quick, lowsodium, slowcooker, kidapproved, special, seafood
- amount must be a number (use 0 if no amount specified)
- unit can be empty string if no unit
- Return ONLY the JSON object, absolutely nothing else`;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await request.json();
      const { type, content, mediaType } = body;

      let messageContent;
      if (type === 'image') {
        messageContent = [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: content } },
          { type: 'text', text: PARSE_PROMPT }
        ];
      } else {
        messageContent = PARSE_PROMPT + '\n\nRecipe to parse:\n\n' + content;
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4096,
          messages: [{ role: 'user', content: messageContent }]
        })
      });

      const data = await response.json();

      return new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};
