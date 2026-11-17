import type { Locale } from '@/lib/i18n/locales'

export const LANDING_PATHS = {
  register: '/register',
  login: '/login',
  dashboard: '/dashboard',
  howItWorks: '/how-it-works',
} as const

export const LANDING_SITE = {
  productionUrl: 'https://pnlens.duii.dev',
  ogImagePath: '/assets/Pnlens_Logo.png',
} as const

export type LandingFeature = {
  id: 'pnl' | 'fees' | 'assistant' | 'demo'
  title: string
  text: string
  points: string[]
}

export type LandingSecurityPoint = {
  title: string
  text: string
}

export type LandingFeeRow = {
  exchange: string
  fees: string
  volume: string
}

export type LandingCopy = {
  meta: { title: string; description: string }
  nav: {
    homeLabel: string
    howItWorks: string
    signIn: string
    getStarted: string
    dashboard: string
    menuLabel: string
  }
  hero: { title: string; lead: string; sampleNote: string }
  exchanges: { title: string; lead: string }
  features: LandingFeature[]
  assistant: { label: string; question: string; answerLines: string[]; sources: string }
  fees: {
    label: string
    exchangeHead: string
    feesHead: string
    volumeHead: string
    rows: LandingFeeRow[]
  }
  security: { title: string; lead: string; points: LandingSecurityPoint[] }
  cta: { title: string; lead: string; learnMore: string }
  footer: { rights: string; guide: string }
}

const EN: LandingCopy = {
  meta: {
    title: 'PnLens - Crypto PNL tracker for every exchange',
    description:
      'Connect read-only API keys from Binance, OKX, Bybit, Bitget and Gate.io. See realized PNL, fees and volume in one dashboard and ask an AI assistant about your trading.',
  },
  nav: {
    homeLabel: 'PnLens home',
    howItWorks: 'How it works',
    signIn: 'Sign in',
    getStarted: 'Get started',
    dashboard: 'Go to dashboard',
    menuLabel: 'Main navigation',
  },
  hero: {
    title: 'Your trading profit and loss, from every exchange, in one place.',
    lead: 'Connect a read-only API key. PnLens reads your trades, works out PNL, fees and volume per exchange, and shows the days and weeks that made or lost money. It cannot trade and it cannot move funds.',
    sampleNote: 'Sample data. The same chart and calendar run on your own trades.',
  },
  exchanges: {
    title: 'Five exchanges, one view',
    lead: 'Binance, OKX, Bybit, Bitget and Gate.io. Look at them together or one at a time.',
  },
  features: [
    {
      id: 'pnl',
      title: 'See what actually made money',
      text: 'A cumulative PNL chart and a daily calendar built from your own fills. Spot PNL is worked out per coin from your buys and sells, and futures results sit next to it.',
      points: ['Week, month and year ranges', 'Daily and monthly calendar', 'Days cut at midnight UTC+7'],
    },
    {
      id: 'fees',
      title: 'Know what trading costs you',
      text: 'Fees and traded volume are split per exchange, so you can see where you pay the most and compare venues over the same period.',
      points: ['Fees per exchange', 'Volume per exchange', 'Spot and futures filters'],
    },
    {
      id: 'assistant',
      title: 'Ask about your own numbers',
      text: 'The AI assistant answers questions about your trading using your stored PNL data, instead of generic market commentary.',
      points: ['Plain-language questions', 'Answers from your trades', 'Chat history kept per account'],
    },
    {
      id: 'demo',
      title: 'Practice without risk',
      text: 'Demo trading lets you try a strategy with virtual funds before you put real money behind it.',
      points: ['Virtual balance', 'No exchange key needed', 'Separate from your real PNL'],
    },
  ],
  assistant: {
    label: 'AI assistant',
    question: 'Which exchange cost me the most in fees this month?',
    answerLines: [
      'Bybit, with 38.20 USDT in fees on 41,300 USDT of volume.',
      'OKX is second at 24.75 USDT. Gate.io has the lowest fee share per traded dollar.',
    ],
    sources: 'Based on your trades from the last 30 days',
  },
  fees: {
    label: 'Fees and volume, last 30 days',
    exchangeHead: 'Exchange',
    feesHead: 'Fees (USDT)',
    volumeHead: 'Volume (USDT)',
    rows: [
      { exchange: 'binance', fees: '19.40', volume: '33,900' },
      { exchange: 'okx', fees: '24.75', volume: '29,150' },
      { exchange: 'bybit', fees: '38.20', volume: '41,300' },
      { exchange: 'bitget', fees: '11.05', volume: '12,480' },
      { exchange: 'gateio', fees: '6.90', volume: '10,220' },
    ],
  },
  security: {
    title: 'Built so it cannot touch your funds',
    lead: 'PnLens only ever needs permission to read.',
    points: [
      {
        title: 'Read-only keys only',
        text: 'Keys that can withdraw are checked and rejected before they are stored.',
      },
      {
        title: 'Encrypted at rest',
        text: 'Stored keys are encrypted with AES-256-GCM and are never shown again after you save them.',
      },
      {
        title: 'No trading, no transfers',
        text: 'PnLens reads trade history. It has no way to place orders or move money.',
      },
    ],
  },
  cta: {
    title: 'See your real numbers',
    lead: 'Create an account, connect one read-only key and run your first scan.',
    learnMore: 'Read the setup guide',
  },
  footer: { rights: 'PnLens. Read-only crypto PNL tracking.', guide: 'How it works' },
}

const VI: LandingCopy = {
  meta: {
    title: 'PnLens - Theo dõi PNL crypto trên mọi sàn',
    description:
      'Kết nối API key chỉ đọc của Binance, OKX, Bybit, Bitget và Gate.io. Xem PNL đã chốt, phí và khối lượng trong một bảng điều khiển và hỏi trợ lý AI về giao dịch của bạn.',
  },
  nav: {
    homeLabel: 'Trang chủ PnLens',
    howItWorks: 'Cách hoạt động',
    signIn: 'Đăng nhập',
    getStarted: 'Bắt đầu',
    dashboard: 'Vào bảng điều khiển',
    menuLabel: 'Điều hướng chính',
  },
  hero: {
    title: 'Lãi lỗ giao dịch của bạn, từ mọi sàn, trong một nơi.',
    lead: 'Kết nối một API key chỉ đọc. PnLens đọc giao dịch, tính PNL, phí và khối lượng theo từng sàn, và cho bạn thấy ngày và tuần nào có lãi hay lỗ. PnLens không thể giao dịch và không thể chuyển tiền.',
    sampleNote: 'Dữ liệu mẫu. Biểu đồ và lịch tương tự chạy trên giao dịch của chính bạn.',
  },
  exchanges: {
    title: 'Năm sàn, một góc nhìn',
    lead: 'Binance, OKX, Bybit, Bitget và Gate.io. Xem gộp hoặc từng sàn.',
  },
  features: [
    {
      id: 'pnl',
      title: 'Biết điều gì thật sự tạo ra lợi nhuận',
      text: 'Biểu đồ PNL tích lũy và lịch theo ngày được dựng từ chính các lệnh khớp của bạn. PNL spot được tính theo từng coin từ lệnh mua và bán, kết quả futures nằm ngay bên cạnh.',
      points: ['Khoảng tuần, tháng và năm', 'Lịch theo ngày và theo tháng', 'Ngày chốt lúc 0 giờ UTC+7'],
    },
    {
      id: 'fees',
      title: 'Biết giao dịch tốn bao nhiêu',
      text: 'Phí và khối lượng giao dịch được tách theo từng sàn, để bạn thấy nơi trả nhiều nhất và so sánh các sàn trong cùng một giai đoạn.',
      points: ['Phí theo sàn', 'Khối lượng theo sàn', 'Bộ lọc spot và futures'],
    },
    {
      id: 'assistant',
      title: 'Hỏi về chính số liệu của bạn',
      text: 'Trợ lý AI trả lời câu hỏi về giao dịch của bạn dựa trên dữ liệu PNL đã lưu, thay vì bình luận thị trường chung chung.',
      points: ['Hỏi bằng ngôn ngữ thường ngày', 'Trả lời từ giao dịch của bạn', 'Lưu lịch sử chat theo tài khoản'],
    },
    {
      id: 'demo',
      title: 'Luyện tập không rủi ro',
      text: 'Giao dịch demo cho phép thử chiến lược bằng vốn ảo trước khi dùng tiền thật.',
      points: ['Số dư ảo', 'Không cần API key sàn', 'Tách biệt với PNL thật'],
    },
  ],
  assistant: {
    label: 'Trợ lý AI',
    question: 'Sàn nào tốn phí nhất của tôi trong tháng này?',
    answerLines: [
      'Bybit, với 38,20 USDT phí trên 41.300 USDT khối lượng.',
      'OKX đứng thứ hai với 24,75 USDT. Gate.io có tỷ lệ phí trên mỗi đô la giao dịch thấp nhất.',
    ],
    sources: 'Dựa trên giao dịch của bạn trong 30 ngày gần nhất',
  },
  fees: {
    label: 'Phí và khối lượng, 30 ngày gần nhất',
    exchangeHead: 'Sàn',
    feesHead: 'Phí (USDT)',
    volumeHead: 'Khối lượng (USDT)',
    rows: [
      { exchange: 'binance', fees: '19,40', volume: '33.900' },
      { exchange: 'okx', fees: '24,75', volume: '29.150' },
      { exchange: 'bybit', fees: '38,20', volume: '41.300' },
      { exchange: 'bitget', fees: '11,05', volume: '12.480' },
      { exchange: 'gateio', fees: '6,90', volume: '10.220' },
    ],
  },
  security: {
    title: 'Thiết kế để không thể chạm vào tiền của bạn',
    lead: 'PnLens chỉ cần quyền đọc.',
    points: [
      {
        title: 'Chỉ nhận key chỉ đọc',
        text: 'Key có quyền rút tiền bị kiểm tra và từ chối trước khi lưu.',
      },
      {
        title: 'Mã hóa khi lưu trữ',
        text: 'Key được mã hóa bằng AES-256-GCM và không bao giờ hiển thị lại sau khi bạn lưu.',
      },
      {
        title: 'Không giao dịch, không chuyển tiền',
        text: 'PnLens chỉ đọc lịch sử giao dịch. Không có cách nào để đặt lệnh hay chuyển tiền.',
      },
    ],
  },
  cta: {
    title: 'Xem số liệu thật của bạn',
    lead: 'Tạo tài khoản, kết nối một key chỉ đọc và chạy lần quét đầu tiên.',
    learnMore: 'Đọc hướng dẫn cài đặt',
  },
  footer: { rights: 'PnLens. Theo dõi PNL crypto ở chế độ chỉ đọc.', guide: 'Cách hoạt động' },
}

export const LANDING_COPY: Record<Locale, LandingCopy> = { en: EN, vi: VI }
