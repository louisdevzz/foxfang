---
title: "Brand File — Reply.cash"
summary: "Brand reference for Reply.cash: product info, positioning, competitive analysis, customer personas, and compliance content guidelines."
read_when:
  - Writing any content, copy, or strategy for Reply.cash
  - Doing competitive analysis or positioning work for Reply.cash
  - Reviewing content before publishing for Reply.cash
---

# Reply.cash — Brand File

A stablecoin-to-local-cash platform for Africa. Lets anyone send USDC/USDT directly to mobile money and bank accounts — recipient gets local currency without needing a crypto wallet.

## ⚠️ Compliance & Content Guidelines

**Read this first before writing any content for Reply.cash.**

Reply.cash operates as a **non-custodial platform** — not a money transfer service or remittance operator. Using regulated financial terminology in content triggers legal/regulatory implications and misrepresents what the product actually is. Always frame content around the product's actual model.

### Words & Phrases to NEVER Use

| ❌ Avoid | ✅ Use instead | Why |
|---|---|---|
| "cross-border remittances" | "borderless access to local payment rails" | "Remittance" implies a licensed MSB/MTL operator — reply.cash is not |
| "cross-border payments" | "pay locally with stablecoins" / "stablecoin payments to local rails" | "Cross-border payments" carries regulatory framing reply.cash doesn't hold |
| "money transfer service" | "stablecoin payment platform" / "local payment rails" | MSB classification — reply.cash is non-custodial, not an MTL |
| "remittance service" | "send stablecoins to mobile money" | Same MSB/MTL issue |
| "send money" | "send stablecoins" / "pay locally" | "Money" implies fiat transfer; reply.cash deals in stablecoins |
| "we hold your funds" / "custody" | "non-custodial" / "you keep control" | Reply.cash never holds user assets |
| "guaranteed rates" | "typical fees under ~2%" / "rates at transaction time" | Rates are shown live in-app, not guaranteed in marketing |
| "live in [country]" (without verifying) | Check https://reply.cash/countries first | Corridor availability changes — never assume |

### Always Frame As

- A **stablecoin payment tool** — not a remittance company
- **Borderless access to local rails** — not cross-border money transfer
- **Non-custodial** — users keep full control of their assets at all times
- Reply.cash **does not do KYC** itself — KYC is handled by third-party integrators (mobile money operators, banks, onramps)
- Reply.cash **cannot freeze balances** — it's non-custodial; only stablecoin issuers (Circle/Tether) can blacklist addresses

### Legal/Compliance Disclaimers to Include When Relevant

- Fees quoted as "typical/marketing" — actual rates shown in app at transaction time
- Country page regulatory summaries are informational only — not legal advice
- Corridor availability: always verify live status at https://reply.cash/countries before claiming a market is live

### Source Docs
- AML Policy: https://marketing.reply.cash/aml
- Terms: https://marketing.reply.cash/terms
- LLMs guide (compliance notes): https://reply.cash/llms.txt

---

## URLs & Channels

| Property | URL |
|----------|-----|
| Landing site | https://reply.cash |
| Web app | https://app.reply.cash |
| Docs | https://docs.reply.cash |
| Marketing hub | https://marketing.reply.cash |
| Narrative & positioning | https://marketing.reply.cash/narrative |
| Personas | https://marketing.reply.cash/personas |
| Changelog | https://changelog.reply.cash |
| Twitter/X | @replydotcash |
| LinkedIn | https://www.linkedin.com/company/replydotcash |
| Discord | https://discord.gg/x8cnwh3g25 |
| AI site guide | https://reply.cash/llms.txt |

> When writing about Reply.cash, fetch **https://reply.cash/llms.txt** first (static AI-readable summary — the main site is a SPA and won't render via fetch). For deeper detail, fetch **https://marketing.reply.cash/narrative**. Corridor availability changes — always verify before writing.

## Product Facts

**Fees:** under ~2% (typical/marketing — actual shown in-app at transaction time)
**Speed:** often under 60 seconds to mobile money
**Custody:** non-custodial — never holds user assets
**KYC:** none required for senders (wallet connect only)
**Backers:** NEAR Foundation
**Tech stack:** React + Vite SPA, built primarily on Solana with 30+ chain support

### Live Countries & Corridors

| Country | Currency | Payment Rails | Status |
|---|---|---|---|
| 🇰🇪 Kenya | KES | M-Pesa, Airtel Money, All Banks | **Available** |
| 🇳🇬 Nigeria | NGN | All Banks (NUBAN), OPay, USSD | **Available** |
| 🇺🇬 Uganda | UGX | MTN Mobile Money, Airtel Money | **Available** |
| 🇨🇩 DR Congo | CDF | Airtel Money, M-Pesa, Orange Money | **Available** |
| 🇬🇭 Ghana | GHS | MTN Mobile Money, AirtelTigo Money, Telecel Cash | **Available** |
| 🇲🇼 Malawi | MWK | Airtel Money, TNM Mpamba | **Available** |
| 🇧🇷 Brazil | BRL | PIX | Coming Soon |
| 🇷🇼 Rwanda | RWF | MTN Mobile Money, Airtel Money | Coming Soon |
| 🇿🇦 South Africa | ZAR | MTN Mobile Money, Vodacom M-Pesa | Coming Soon |
| 🇹🇿 Tanzania | TZS | M-Pesa, Airtel Money, Tigo Pesa | Coming Soon |
| 🇿🇲 Zambia | ZMW | MTN Mobile Money, Airtel Money | Coming Soon |
| 🇨🇲 Cameroon | XAF | Orange Money, MTN Mobile Money | Coming Soon |
| 🇸🇳 Senegal | XOF | Orange Money, Tigo Cash | Coming Soon |
| 🇨🇮 Ivory Coast | XOF | Orange Money, MTN Mobile Money | Coming Soon |
| 🇧🇯 Benin | XOF | MTN Mobile Money, Moov Money | Coming Soon |
| + more | — | — | Coming Soon |

> Always verify current status at https://reply.cash/countries — corridors change.

### Supported Payment Platforms

| Platform | Country | Status |
|---|---|---|
| M-Pesa | 🇰🇪 Kenya | Live |
| Airtel Money | Multi-country (Uganda, DRC, more) | Live |
| OPay | 🇳🇬 Nigeria | Live |
| USSD | 🇳🇬 Nigeria | Live |
| Orange Money Congo | 🇨🇩 DR Congo | Live |
| TNM Mpamba | 🇲🇼 Malawi | Live |
| AirtelTigo Money | 🇬🇭 Ghana | Live |
| Telecel Cash | 🇬🇭 Ghana | Live |
| Privacy Cash | — | Coming Soon |

### Supported Chains (30+)

Primary: **Solana** (main chain, lowest fees <$0.01)

Also supported: NEAR, Arbitrum, Ethereum, Base, Bitcoin, Polygon, Optimism, Avalanche, BNB Chain, TON, Tron, Sui, Starknet, Cardano, Stellar, XRP, and more. Full list: https://reply.cash/chains

### Supported Wallets

Phantom, Solflare, Backpack, Jupiter, Brave Wallet, Trust Wallet, OKX Wallet, MetaMask, Hot Wallet. Full list: https://reply.cash/wallets

## Core Value Proposition

> "Spend crypto like cash, anywhere."

Bridges the gap between stablecoin holdings and real-world spending by integrating directly with local payment rails — mobile money, UPI, bank transfers, and QR codes. No wallet requirements for recipients, no complex onboarding, just instant conversion from stablecoins to local currency.

**Human angle:** _"send USDC, your family gets M-Pesa cash."_

## Key Differentiators

- **Self-custodial** — users keep full control of assets
- **Privacy-first** — no KYC, no registration, zero data retention
- **Multi-chain** — any stablecoin, any wallet, 30+ chains
- **Walletless recipients** — they only need a phone number
- **Sub-2% fees** vs 5–7% for traditional remittances
- **<60s settlement** vs 2–4 days for traditional services
- **No telco registration** — no identity or location exposure

## Values

| Value | Description |
|---|---|
| Self-Custody | Non-custodial — we never hold your assets |
| Privacy First | Private top-ups, private transfers, zero data retention |
| Universal Liquidity | Access all liquidity across chains with private payouts |
| Effortless Payments | Minimal clicks, fast confirmation, clear receipts |
| Fast, Cheap, Reliable | Fast rails, sub-2% fees, high uptime |
| Integrations-heavy | Build on DeFi and traditional rails for maximum interconnectivity |

## Competitive Positioning

### vs Traditional Remittance (Western Union, MoneyGram)
- **Their model:** 5–7% fees, 2–4 day settlement, requires bank account or pickup
- **Our advantage:** Sub-2% fees, <60s settlement, direct to mobile money
- **Message:** "Why wait days and pay 7% when you can send instantly for a fraction?"

### vs Crypto→Mobile Money (Kotani Pay, Valora)
- **Their model:** Single chain (e.g. Celo), limited geography, app-specific wallets
- **Our advantage:** Multi-chain (Solana, ETH, Base, Polygon), universal wallets, broader rails
- **Message:** "Use any wallet, any stablecoin, any chain — reply.cash works with what you have."

### vs Neobanks & Fintech (Wise, Revolut)
- **Their model:** KYC required, bank linking, limited crypto, fiat-only
- **Our advantage:** No KYC for wallet, native stablecoins, self-custodial
- **Message:** "Keep stablecoins sovereign. Spend anywhere without custody or privacy tradeoffs."

### vs Stablecoin Issuers (Circle, PayPal)
- **Their model:** Single stablecoin, own networks, custodial
- **Our advantage:** Stablecoin-agnostic, existing local rails, self-custody
- **Message:** "We don't compete with stablecoins — we make all stablecoins spendable everywhere."

## Customer Personas (12 total)

### High Priority

| Persona | Segment | Key pain points |
|---|---|---|
| **African Who Frequents Multiple Countries** | Cross-border | 5–15% cross-border fees; 3–8% FX losses; needs to pay suppliers fast |
| **Crypto Person Who Makes Payments** | Crypto-native | Tx speed, high fees, limited real-world spending options |
| **International Tourist to East/West Africa** | Travel | Can't use international cards for M-Pesa; card blocks; needs cash on arrival |
| **No ID but Wants to Pay Local Rails** | Unbanked | No official ID → no banking; bureaucratic barriers; needs crypto→mobile money |
| **Someone Who Wants Untraceable Funds** | Privacy | Can't use crypto for local payments without revealing identity; lengthy KYC |

### Medium Priority

| Persona | Segment | Key pain points |
|---|---|---|
| **African Diaspora Remittance Sender** | Diaspora | 6–7% fees, 3–5 day delays; Sub-Saharan Africa averages 7.9% — highest globally |
| **Chains Looking for Distribution** | B2B / Ecosystem | Only 2–5% of crypto holders use assets for everyday tx; no mobile money on/off-ramps |
| **Mobile Money User Sending Crypto Without Crypto Knowledge** | Mobile money | Reluctant to learn crypto; wants to use familiar M-Pesa flows |
| **New to Crypto** | Beginner | Overwhelmed by complexity; security concerns |
| **Privacy-Conscious Crypto Earner** | Privacy | Complex offramps; 3–7% fees; 10+ pain points |
| **Someone Who Wants to Bridge Into Solana** | Solana | Hard to bridge from other chains; complex multi-step processes |

### Low Priority

| Persona | Segment | Key pain points |
|---|---|---|
| **Cross-Chain Crypto Native User** | Crypto-native | Fragmented liquidity; high friction fiat offramps (3–5%) |

Full persona details: https://marketing.reply.cash/personas

## Primary Market Narratives

### 1. Stablecoin Payments to Local Rails — Instant, Cheap
- **Target:** Crypto holders paying family or contacts in emerging markets
- **Pain:** Traditional wire services: 2–4 days, 5–7% fees. Recipients need bank accounts.
- **Solution:** Stablecoin → M-Pesa/MTN in under 60 seconds, sub-2% cost.
- **Example:** Maria in Miami holds USDC → mom in Nairobi gets 13,000 KES in M-Pesa instantly.

### 2. Borderless Commerce for Travelers & Digital Nomads
- **Target:** International travelers, digital nomads, crypto natives in emerging markets
- **Pain:** Mobile money setup requires local ID, 3–7 day registration, exposes location.
- **Solution:** Top up with stablecoins once. Pay via QR, mobile money numbers, or UPI without registration.
- **Example:** James in Kenya for 2 weeks pays merchants with USDC via reply.cash — no M-Pesa registration.

### 3. Privacy-Conscious Local Payments
- **Target:** Users concerned about financial surveillance via mobile money
- **Pain:** Mobile money links phone to gov ID and enables real-time tracking.
- **Solution:** Fresh wallets fund payments. Recipients get mobile money; sender identity stays private.

### 4. Stablecoin Utility for the Unbanked
- **Target:** Unbanked populations who want dollar savings without banking
- **Pain:** 1.4B adults unbanked, 5.8B with smartphones. Local currencies volatile.
- **Solution:** Hold USDC (dollar-denominated). Spend via mobile money — no bank account required.
- **Example:** Aisha in Nigeria saves in USDC vs Naira inflation, pays rent by converting instantly.

### 5. Merchant Acceptance Without Crypto Complexity
- **Target:** Merchants in emerging markets who want to accept crypto
- **Solution:** Merchant shares mobile money or bank details. Customers pay with stablecoins. Merchant gets local currency instantly.
- **Example:** Coffee shop in Kampala shows QR. Tourists pay USDC. Owner receives UGX in mobile money.

## Objection Handling

| Objection | Response |
|---|---|
| "Why not just use mobile money directly?" | Mobile money needs telco registration (3–7 days), exposes identity/location. reply.cash: hold stablecoins, pay any mobile money number instantly — no registration, no identity exposure. |
| "Isn't this just for crypto people?" | Senders need wallets; recipients don't. 86M crypto holders can send to 1.6B mobile money users who've never used crypto. |
| "Volatility risk?" | Uses stablecoins (USDC, USDT) pegged 1:1 to USD. No volatility. Conversion to local currency at payment time. |
| "How is this different from an exchange?" | Exchanges buy/sell crypto. reply.cash lets you spend it for real-world payments — no cashing out to bank first. |
| "Regulations and compliance?" | Partners with licensed payment processors and mobile money operators. Compliance through integration partners. |

## Brand Messaging

**Primary taglines:**
- "Spend crypto like cash, anywhere"
- "Your stablecoins. Their mobile money. Instant."
- "Borderless money for local payments"
- "From any wallet to any payment method"

**Supporting messages:**
- **Universality:** Any stablecoin, any chain, any wallet — spend anywhere
- **Simplicity:** Recipients don't need crypto. Just phone numbers or QR codes.
- **Speed:** Instant conversion. Real-time settlement. No waiting.
- **Privacy:** Pay without revealing identity, location, or history.
- **Cost:** Sub-2% fees. No hidden charges. Transparent.

## Content Types (10 types)

Use these when generating content for Reply.cash. Each type has a purpose and frequency guidance.

| Type | Purpose | Frequency | Example topics |
|---|---|---|---|
| **Stats** | Market data on stablecoins/payments to establish the problem & solution | Heavy | Mobile money adoption rates, stablecoin volume, fee comparisons |
| **Product Features** | Advertise features, raise product awareness | Often | How to pay M-Pesa from Solana, how to do private transfers, supported wallets |
| **Thought Leadership** | Industry insights beyond just reply.cash — positions as expert | Heavy | Why stablecoins are US dollar hegemony's last stand, trading vs payment chains, privacy stablecoins |
| **Memes** | Drive concepts in a funny/engaging way | — | Wallet setup memes, "making a wallet after you get money" Drake meme |
| **Stablecoin/Payments Ecosystem Highlight** | Spotlight other projects — broker partnerships, reinforce thought leadership | — | How USDC works, KAST Card, best stablecoin payment card solutions |
| **News** | React to industry news | — | Revolut enters crypto, Klarna gets into stablecoins, Genius Act updates |
| **Influencer Video UGC** | Creator-generated video content | — | "I paid my friend in Kenya using only crypto" |
| **Case Study Integration** | Deep dives on specific integrations or use cases | — | PIX in Brazil, M-Pesa adoption impact |
| **Commercial** | Direct product ads | — | "Split the Bill" scenarios, merchant acceptance stories |
| **Growth Campaigns** | Campaign-specific content for launches/milestones | — | Country launch announcements, new chain support |

**Key stat templates to use:**
- 96% of Kenyan households use mobile money; processes 50% of Kenya's GDP
- Sub-Saharan Africa has the world's highest average fee for traditional services (7.9% — World Bank)
- 1.4B adults unbanked globally; 5.8B have smartphones
- 86M+ crypto holders can reach 1.6B mobile money users via reply.cash

## Vision & Mission

**Mission:** Make stablecoins spendable everywhere by bridging crypto and local payment infrastructure, enabling financial inclusion and borderless commerce for billions.

**Vision:** A world where anyone can send and receive money instantly, privately, and affordably — regardless of banking access, location, or technical knowledge.

**3-year roadmap:**
- Year 1: 5 key corridors (US→Kenya, India, Philippines, Nigeria, Brazil). $50M volume.
- Year 2: 25 countries, mobile money + UPI + QR. Merchant acceptance. $500M volume.
- Year 3: Default stablecoin payment layer. Wallets, social, DeFi. $5B+ volume.
