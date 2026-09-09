-- Schedules the sweep. Run once in the Supabase SQL Editor, after the functions
-- are deployed and WEBHOOK_SECRET is set.
--
-- Replace <PROJECT_REF> and <WEBHOOK_SECRET> before running.
--
-- The sweep polls Robinhood Chain (which has no webhook provider) and reconciles
-- Solana against the webhook. Webhook delivery is not guaranteed, and without
-- this a dropped push would be a permanently missed trade.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running this file replaces the schedule rather than duplicating it.
select cron.unschedule('whale-sweep') where exists (
    select 1 from cron.job where jobname = 'whale-sweep'
);

select cron.schedule(
    'whale-sweep',
    '*/5 * * * *',
    $$
    select net.http_post(
        url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/whale-sweep',
        headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', '<WEBHOOK_SECRET>'
        ),
        timeout_milliseconds := 55000
    );
    $$
);

-- Check it is scheduled:
--   select jobname, schedule, active from cron.job;
-- Check recent runs:
--   select start_time, status, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'whale-sweep')
--   order by start_time desc limit 10;
