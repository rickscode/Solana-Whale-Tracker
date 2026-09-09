import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/constants';
import { logger } from '../utils/logger';

let client: SupabaseClient | null = null;

/** Created on first use, so missing credentials surface as a normal error and not an import crash. */
export function getSupabase(): SupabaseClient {
    if (!client) {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
        }
        client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
    }
    return client;
}

export async function testConnection(): Promise<boolean> {
    try {
        const { error } = await getSupabase()
            .from('wallets')
            .select('id', { count: 'exact', head: true });

        if (error) {
            logger.error('Supabase connection failed:', error.message);
            return false;
        }
        logger.info('Supabase connected');
        return true;
    } catch (error) {
        logger.error('Supabase connection error:', error instanceof Error ? error.message : error);
        return false;
    }
}
