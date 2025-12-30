# Solana Whale Tracker

A real-time Telegram bot that monitors Solana whale wallet transactions, helping you track smart money movements on the Solana blockchain.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)

## Features

- Real-time monitoring of multiple Solana wallet addresses via Helius API
- Instant Telegram notifications for buy and sell transactions
- Smart filtering to only alert on significant buys (configurable minimum value)
- Complete position tracking with P&L calculations
- Hold duration analysis
- PostgreSQL database (Supabase) for reliable data persistence
- Direct links to Solscan for transaction verification
- TypeScript for type safety and better developer experience

## How It Works

1. **Continuous Monitoring**: Polls Helius API every 10 seconds for new transactions from tracked wallets
2. **Transaction Parsing**: Identifies SWAP operations on Solana DEXs (Raydium, Orca, Jupiter, etc.)
3. **Intelligent Filtering**:
   - Buy alerts only trigger for transactions >= $1,000 USD (configurable)
   - All sell transactions are reported (no filtering)
4. **Position Tracking**: Matches sells with corresponding buys to calculate profit/loss
5. **Instant Notifications**: Sends formatted alerts to your Telegram with all relevant details

## Prerequisites

Before setting up the tracker, you'll need:

- **Node.js** v18 or higher
- **Helius API Key** - [Sign up for free](https://www.helius.dev/) (100k requests/day on free tier)
- **Supabase Account** - [Create account](https://supabase.com/) (free tier available)
- **Telegram Bot Token** - Create via [@BotFather](https://t.me/botfather)
- **Whale Wallet Addresses** - Addresses you want to monitor

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/solana-whale-tracker.git
cd solana-whale-tracker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:

```env
# Helius API Configuration
HELIUS_API_KEY=your_helius_api_key_here

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789

# Monitoring Configuration
POLL_INTERVAL_MS=10000
MIN_BUY_VALUE_USD=1000

# Application Configuration
NODE_ENV=production
LOG_LEVEL=info
```

### 4. Set Up Database

1. Log into your [Supabase Dashboard](https://app.supabase.com/)
2. Select your project or create a new one
3. Navigate to **SQL Editor**
4. Copy the contents of `src/database/schema.sql`
5. Paste and execute the SQL script

This creates the required tables (`positions` and `processed_signatures`) with proper indexes.

### 5. Configure Wallets to Track

Edit `src/config/wallets.json` and add the whale wallet addresses:

```json
{
  "wallets": [
    {
      "address": "6FNy8RFVYoWUZU4TcsjwYp9dSCxe9GUxELg5qy4oekbS",
      "label": "Whale 1"
    },
    {
      "address": "ANOTHER_WALLET_ADDRESS_HERE",
      "label": "Smart Money Trader"
    }
  ]
}
```

Tips for finding whale wallets:
- Use [DexScreener](https://dexscreener.com/) to find top holders of trending tokens
- Check [Solscan](https://solscan.io/) for high-balance wallets
- Follow crypto Twitter accounts that share whale addresses

### 6. Get Your Telegram Chat ID

To receive notifications, you need your Telegram Chat ID:

1. Start a chat with your bot on Telegram
2. Send any message to the bot
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Find `"chat":{"id":123456789}` in the JSON response
5. Use that number as your `TELEGRAM_CHAT_ID` in `.env`

## Usage

### Development Mode

Run with auto-reload on code changes:

```bash
npm run dev
```

### Production Build

Compile TypeScript and run:

```bash
npm run build
npm start
```

### Using PM2 (Recommended for Production)

PM2 keeps your bot running 24/7 and restarts it automatically on crashes:

```bash
# Install PM2 globally
npm install -g pm2

# Build the project
npm run build

# Start with PM2
pm2 start dist/index.js --name whale-tracker

# View status
pm2 status

# View logs
pm2 logs whale-tracker

# Monitor resources
pm2 monit

# Auto-restart on server reboot
pm2 startup
pm2 save
```

Useful PM2 commands:
```bash
pm2 restart whale-tracker   # Restart the bot
pm2 stop whale-tracker       # Stop the bot
pm2 delete whale-tracker     # Remove from PM2
```

## Notification Examples

### Buy Alert

```
BUY ALERT

Wallet: Whale 1
6FNy...ekbS

Token: BONK
Amount: 1,000,000
Price: $0.000025
Value: $25.00K

View Transaction →
```

### Sell Alert

```
SELL ALERT

Wallet: Smart Money Trader
7Abc...xyz9

Token: BONK
Amount: 1,000,000

Buy Price: $0.000025
Sell Price: $0.000035

Buy Value: $25.00K
Sell Value: $35.00K

P&L: $10.00K (+40.00%)
Hold Time: 2d 5h

View Transaction →
```

## Configuration

### Adjusting Buy Alert Threshold

Only receive alerts for buys above a certain value:

```env
MIN_BUY_VALUE_USD=1000  # Default: $1,000
```

Set lower for more alerts, higher for only significant positions.

### Changing Poll Interval

Adjust how frequently the bot checks for new transactions:

```env
POLL_INTERVAL_MS=10000  # Default: 10 seconds (10000ms)
```

**Note**: Lower values = faster alerts but more API calls. Monitor your Helius usage.

### Enabling Debug Logs

For troubleshooting, enable detailed logging:

```env
LOG_LEVEL=debug  # Options: error, warn, info, debug
```

## Project Structure

```
solana-whale-tracker/
├── src/
│   ├── config/
│   │   ├── constants.ts      # App constants
│   │   └── wallets.json      # Tracked wallet addresses
│   ├── database/
│   │   ├── schema.sql        # Database schema
│   │   ├── supabase.ts       # Supabase client
│   │   └── queries.ts        # Database queries
│   ├── services/
│   │   ├── helius.ts         # Helius API integration
│   │   ├── telegram.ts       # Telegram bot notifications
│   │   └── parser.ts         # Transaction parsing logic
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   ├── utils/
│   │   ├── filters.ts        # Transaction filters
│   │   └── logger.ts         # Logging utility
│   └── index.ts              # Main application entry
├── .env.example              # Example environment variables
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## API Rate Limits

### Helius Free Tier
- **100,000 requests/day**
- With 3 wallets @ 10-second polling: ~25,920 requests/day
- You're well within limits, but monitor usage if tracking many wallets

To check your usage:
1. Visit [Helius Dashboard](https://dashboard.helius.dev/)
2. Navigate to your API key
3. View request statistics

## Important Notes

### SOL Price Estimation

The current implementation uses a **placeholder SOL price** for calculating USD values when DEX swaps involve SOL (not stablecoins).

**Location**: `src/services/parser.ts` (around line 72)

```typescript
const estimatedSolPrice = 100; // REPLACE WITH ACTUAL PRICE FEED
```

**TODO**: Integrate a real-time price oracle:
- [Pyth Network](https://pyth.network/) (recommended for Solana)
- [Chainlink](https://chain.link/)
- REST API from [CoinGecko](https://www.coingecko.com/en/api) or [CoinMarketCap](https://coinmarketcap.com/api/)

### Database Maintenance

Processed transaction signatures are stored indefinitely. To prevent unbounded growth:

```sql
-- Run this monthly in Supabase SQL Editor
DELETE FROM processed_signatures
WHERE processed_at < NOW() - INTERVAL '30 days';
```

Or set up a Supabase cron job to automate this.

## Troubleshooting

### "Missing required environment variables"

**Solution**:
- Verify all variables in `.env` match `.env.example`
- Ensure the file is named `.env` exactly (not `.env.txt`)
- Restart the application after changing `.env`

### "Supabase connection failed"

**Solution**:
- Double-check `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`
- Verify you ran `schema.sql` in Supabase SQL Editor
- Check that tables exist: Go to Supabase Dashboard > Table Editor

### "No transactions detected"

**Solution**:
- Verify wallet addresses in `wallets.json` are correct (58 characters, base58 encoded)
- Check if the wallets are actually trading: Visit Solscan and search the address
- Confirm your `HELIUS_API_KEY` is valid and has available credits
- Check logs with `LOG_LEVEL=debug` to see API responses

### "Rate limit exceeded"

**Solution**:
- Increase `POLL_INTERVAL_MS` to reduce request frequency
- Reduce the number of tracked wallets
- Upgrade your Helius plan for higher limits

### Bot stops working after some time

**Solution**:
- Use PM2 to auto-restart on crashes: `pm2 start dist/index.js --name whale-tracker`
- Check PM2 logs: `pm2 logs whale-tracker`
- Review error logs for specific issues

## Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Follow existing code style (TypeScript, ESLint)
- Add comments for complex logic
- Update README if adding new features
- Test thoroughly before submitting PR

## Roadmap

- [ ] Integrate real-time SOL price oracle (Pyth Network)
- [ ] Add Telegram commands (`/addwallet`, `/removewallet`, `/stats`)
- [ ] Web dashboard for viewing historical positions
- [ ] More advanced filters (token age, liquidity requirements, DEX routing)
- [ ] Pattern recognition (whale accumulation detection)
- [ ] Multi-chain support (Ethereum, Base, Arbitrum)
- [ ] Export position history to CSV
- [ ] Webhook support for Discord/Slack

## Security

- Never commit your `.env` file (already in `.gitignore`)
- Keep API keys and bot tokens secure
- Use environment variables for all secrets
- Enable Supabase Row Level Security (RLS) for production deployments
- Regularly rotate API keys and tokens

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

**This software is for educational and informational purposes only.**

- Not financial advice
- Use at your own risk
- No guarantee of accuracy or profitability
- Trading cryptocurrencies carries significant risk
- Always do your own research (DYOR)

## Support

If you encounter issues or have questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review logs: `pm2 logs whale-tracker` or `npm run dev` output
3. Enable debug logging: `LOG_LEVEL=debug` in `.env`
4. Open an issue on GitHub with:
   - Description of the problem
   - Relevant logs (remove sensitive info)
   - Steps to reproduce

## Acknowledgments

- [Helius](https://helius.dev/) for excellent Solana API infrastructure
- [Supabase](https://supabase.com/) for hosted PostgreSQL
- Solana community for comprehensive documentation
- All contributors who help improve this project

---

**Built with ❤️ by the crypto community**

If this project helps you, consider:
- Starring the repository
- Sharing with other traders
- Contributing improvements
- Reporting bugs
