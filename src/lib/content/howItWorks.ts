import type { Exchange } from '@/lib/types'
import { getExchangeBrand } from '@/lib/exchangeBranding'
import { EXCHANGE_SCAN_LIMITS, SCAN_COOLDOWN_MS } from '@/lib/scan/scanLimits'

const MS_PER_MINUTE = 60 * 1000

export const SCAN_COOLDOWN_MINUTES = SCAN_COOLDOWN_MS / MS_PER_MINUTE

export const HOW_IT_WORKS_PATH = '/how-it-works'

export const HOW_IT_WORKS_META = {
  title: 'How it works',
  description:
    'Connect a read-only API key from Binance, OKX, Bybit, Bitget or Gate.io and see your real trading PNL in PnLens. A step-by-step guide with answers to common questions.',
} as const

export const HOW_IT_WORKS_HERO = {
  title: 'How it works',
  lead: 'PnLens turns the trade history on your exchange accounts into clear profit and loss numbers. You connect a read-only key, PnLens reads your trades, and the dashboard does the math. It cannot trade, and it cannot move your money.',
} as const

export type GuideSection = {
  id: string
  title: string
}

export const GUIDE_SECTIONS: GuideSection[] = [
  { id: 'overview', title: 'What PnLens does' },
  { id: 'steps', title: 'Get started' },
  { id: 'security', title: 'Security' },
  { id: 'faq', title: 'FAQ' },
]

export const OVERVIEW = {
  title: 'What PnLens does',
  intro:
    'PnLens is a trading PNL tracker for people who use more than one exchange. It reads your fills from each venue and shows them in one place.',
  points: [
    'Realized PNL across Binance, OKX, Bybit, Bitget and Gate.io, side by side or per exchange.',
    'A daily PNL calendar and charts for any date range, so you can see which days and weeks made or lost money.',
    'Spot PNL worked out per coin from your buys and sells, plus futures results and fees.',
    'An AI assistant that answers questions about your own numbers.',
  ],
} as const

export type GuideStep = {
  id: string
  title: string
  body: string[]
}

export const SETUP_STEPS: GuideStep[] = [
  {
    id: 'account',
    title: 'Create your PnLens account',
    body: [
      'Sign up with your email and a password, or continue with Google. Nothing else is needed to look around.',
    ],
  },
  {
    id: 'key',
    title: 'Create a read-only API key on your exchange',
    body: [
      'An API key is a pair of credentials that lets PnLens read your account. Create it inside your exchange, and give it the read permission only.',
      'Leave trading, transfers and withdrawals switched off. PnLens checks the key when you connect it and refuses any key that can withdraw.',
    ],
  },
  {
    id: 'connect',
    title: 'Connect the key in PnLens',
    body: [
      'Open Exchange in the app, pick your exchange and paste the credentials listed in step 2. PnLens tests the key straight away and tells you if a permission is wrong.',
    ],
  },
  {
    id: 'sync',
    title: 'Run a scan to import your trades',
    body: [
      `Press Sync on the connected exchange. Each scan reads the longest history that exchange allows (listed in step 2) up to now.`,
      `The scan runs in the background, so you can leave the page. You can run another scan after about ${SCAN_COOLDOWN_MINUTES} minutes.`,
    ],
  },
  {
    id: 'calculate',
    title: 'Calculate and read your PNL',
    body: [
      'Open the dashboard and press Calculate. You get the summary, the PNL chart, the daily calendar and your recent trades.',
      'Days follow UTC+7. A trade made late in the evening in another time zone can land on the next calendar day.',
    ],
  },
  {
    id: 'assistant',
    title: 'Ask the AI assistant',
    body: [
      'Open AI Assistant and ask things like which coin cost you the most this month or how your fees compare to your profit. It answers from your imported trades.',
    ],
  },
]

export type ExchangeGuide = {
  exchange: Exchange
  fields: string[]
  keyPair: 'ed25519' | 'rsa' | null
  steps: string[]
  note: string | null
}

export const EXCHANGE_GUIDES: ExchangeGuide[] = [
  {
    exchange: 'binance',
    fields: ['API key', 'Private key'],
    keyPair: 'ed25519',
    steps: [
      'Generate a key pair on your computer (see "Generate a key pair" below). Ed25519 is recommended, RSA 2048 also works.',
      'In Binance open API Management and choose Create API, then the self-generated (asymmetric) option.',
      'Paste the contents of public_key.pem, including the BEGIN and END lines, into the public key box.',
      'Enable Reading only. Keep trading, margin, futures trading and withdrawals off.',
      'Copy the API key Binance gives you. In PnLens paste it with the contents of private_key.pem.',
    ],
    note: 'Binance has no secret for this kind of key. Your private key takes its place.',
  },
  {
    exchange: 'okx',
    fields: ['API key', 'Secret', 'Passphrase'],
    keyPair: null,
    steps: [
      'In OKX open the API page and create a new API key.',
      'Choose the Read only permission. Do not tick Trade or Withdraw.',
      'Set a passphrase and remember it. OKX cannot show it again.',
      'Copy the key and the secret shown once after creation, and paste all three into PnLens.',
    ],
    note: 'If any of the three values is missing or mistyped, OKX rejects the key.',
  },
  {
    exchange: 'bybit',
    fields: ['API key', 'Private key'],
    keyPair: 'rsa',
    steps: [
      'Generate an RSA 2048 key pair on your computer (see "Generate a key pair" below).',
      'In Bybit open API Management and create a key of the self-generated (RSA) type.',
      'Paste the contents of public_key.pem into the public key box.',
      'Set the permission to Read-Only. Leave order placement, withdrawals and transfers unchecked.',
      'Copy the API key. In PnLens paste it with the contents of private_key.pem.',
    ],
    note: null,
  },
  {
    exchange: 'bitget',
    fields: ['API key', 'Passphrase', 'Private key'],
    keyPair: 'rsa',
    steps: [
      'Generate an RSA 2048 key pair on your computer (see "Generate a key pair" below).',
      'In Bitget open API key management and create a key with a self-generated RSA public key.',
      'Paste the contents of public_key.pem, and set a passphrase you will remember.',
      'Grant read permission only. Leave trade, transfer and withdraw off.',
      'Copy the API key. In PnLens paste the key, the passphrase and the contents of private_key.pem.',
    ],
    note: null,
  },
  {
    exchange: 'gateio',
    fields: ['API key', 'Secret'],
    keyPair: null,
    steps: [
      'In Gate.io open API management and create a new API v4 key.',
      'Set every permission you are offered to Read only. Leave spot trade, futures trade and withdrawal off.',
      'Copy the key and the secret shown after creation, and paste both into PnLens.',
    ],
    note: 'Gate.io shows the secret once. Save it before you close the page.',
  },
]

export const KEY_PAIR_GUIDE = {
  title: 'Generate a key pair',
  intro:
    'Binance, Bybit and Bitget ask you to bring your own key pair. You give the exchange the public half and PnLens the private half. Run these commands in a terminal where OpenSSL is installed.',
  commands: {
    ed25519: {
      label: 'Ed25519 (Binance, recommended)',
      lines: [
        'openssl genpkey -algorithm ed25519 -out private_key.pem',
        'openssl pkey -in private_key.pem -pubout -out public_key.pem',
      ],
    },
    rsa: {
      label: 'RSA 2048 (Bybit, Bitget, or Binance)',
      lines: [
        'openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private_key.pem',
        'openssl pkey -in private_key.pem -pubout -out public_key.pem',
      ],
    },
  },
  outro:
    'The private key starts with -----BEGIN PRIVATE KEY-----, which is the form PnLens expects. Never share it, and never paste it anywhere except the PnLens connect form. Binance and Bybit also publish a small desktop key generator if you prefer clicking to typing.',
} as const

export const CREDENTIALS_TABLE = {
  title: 'What each exchange needs',
  head: { exchange: 'Exchange', fields: 'You paste into PnLens', history: 'History per scan' },
} as const

export function getHistoryDays(exchange: Exchange): number {
  return EXCHANGE_SCAN_LIMITS[exchange].maxLookbackDays
}

export const SECURITY = {
  title: 'Security',
  intro: 'You are handing PnLens a key to your trading history, so the rules are strict and simple.',
  points: [
    {
      title: 'Read-only, enforced',
      text: 'PnLens asks the exchange what the key can do before it saves anything. A key that can trade or withdraw is rejected, even if you meant to allow it.',
    },
    {
      title: 'Encrypted at rest',
      text: 'Your credentials are encrypted with AES-256-GCM before they are stored. They are decrypted only while a scan is running.',
    },
    {
      title: 'Yours to remove',
      text: 'You can delete a connected exchange at any time from the Exchange page. Revoke the key on the exchange as well if you want to be sure.',
    },
  ],
} as const

export type FaqItem = {
  question: string
  answer: string
}

function describeHistoryWindows(): string {
  return EXCHANGE_GUIDES.map(
    (guide) => `${getExchangeBrand(guide.exchange)?.name ?? guide.exchange} ${getHistoryDays(guide.exchange)} days`
  ).join(', ')
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Why does PnLens only accept read-only keys?',
    answer:
      'PnLens only needs to see your trades. A read-only key cannot place orders or withdraw funds, so the worst case from a leak is that someone sees your history. PnLens rejects any key that has trade or withdraw permission.',
  },
  {
    question: 'How far back does my history go?',
    answer: `Each scan reads the longest window the exchange gives out: ${describeHistoryWindows()}. Older trades are not available through the exchange API, so they cannot be imported.`,
  },
  {
    question: 'Why do my numbers differ from the exchange app?',
    answer:
      'Exchanges group days by their own time zone and may count unrealized PNL, funding or promotions in their headline figure. PnLens counts realized results from your fills and groups days in UTC+7. Deposits and withdrawals are not treated as profit or loss.',
  },
  {
    question: 'My scan is stuck or says I am rate limited.',
    answer: `Scans run in the background and can take a few minutes for a long history. After a scan finishes you can start another one about ${SCAN_COOLDOWN_MINUTES} minutes later. If it still looks stuck after half an hour, start a new scan; the old one is released automatically.`,
  },
  {
    question: 'Are trading fees included?',
    answer:
      'Yes. Fees are taken from your fills and counted against your results, and the dashboard shows what you paid.',
  },
  {
    question: 'The exchange says my key is invalid or lacks permission.',
    answer:
      'Check that you copied every credential for that exchange (listed in step 2), that the passphrase is the one you set, and that Reading is enabled. If you added an IP restriction on the exchange, scans from other addresses will fail, so remove the restriction or create a new key.',
  },
  {
    question: 'How do I delete a key?',
    answer:
      'Open Exchange in the app and remove the connected account. PnLens deletes the stored credentials. To be fully safe, also delete the API key in your exchange settings.',
  },
  {
    question: 'Can PnLens place trades for me?',
    answer: 'No. It has no trading access, and the AI assistant can only read your imported data.',
  },
  {
    question: 'Do I need to scan every day?',
    answer:
      'Scan whenever you want fresh numbers. Every scan re-reads the full window and updates your trades, so nothing is missed between scans as long as the trades fall inside the exchange history window.',
  },
]

export const PAGE_CHROME = {
  tocLabel: 'On this page',
  loginLabel: 'Log in',
  signupLabel: 'Sign up',
  loginHref: '/login',
  signupHref: '/register',
  homeLabel: 'PnLens home',
  footer: 'PnLens only ever reads your trades. Your funds stay on your exchange.',
  tableCaption: 'Credentials and history window for each supported exchange',
  keyPairLink: 'Need a key pair? See how to generate one',
} as const

export const SETTINGS_HELP_PATH = HOW_IT_WORKS_PATH
