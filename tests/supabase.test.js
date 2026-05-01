import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('utils/supabase.js — env-var validation', () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    afterEach(() => {
        // Restore env vars after each test
        if (originalUrl !== undefined) {
            process.env.SUPABASE_URL = originalUrl;
        } else {
            delete process.env.SUPABASE_URL;
        }
        if (originalKey !== undefined) {
            process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
        } else {
            delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        }
    });

    it('throws with SUPABASE_URL in message when SUPABASE_URL is missing', async () => {
        delete process.env.SUPABASE_URL;
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

        await expect(import('../utils/supabase.js?missing-url=' + Date.now())).rejects.toThrow('SUPABASE_URL');
    });

    it('throws with SUPABASE_SERVICE_ROLE_KEY in message when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
        process.env.SUPABASE_URL = 'https://test.supabase.co';
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;

        await expect(import('../utils/supabase.js?missing-key=' + Date.now())).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY');
    });
});
