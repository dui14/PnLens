import { ProxyAgent } from 'undici'
import type { Dispatcher } from 'undici'

type FetchExchangeOptions = RequestInit & {
	proxy?: string | null
}

const proxyAgentCache = new Map<string, ProxyAgent>()

function normalizeProxyParts(
	host: string,
	port: string,
	username?: string | null,
	password?: string | null
): string {
	const normalizedHost = host.trim()
	const normalizedPort = port.trim()

	const hasAuth = Boolean(username)
	const encodedUsername = hasAuth ? encodeURIComponent(String(username ?? '').trim()) : ''
	const encodedPassword = hasAuth
		? encodeURIComponent(String(password ?? '').trim())
		: ''

	const authSegment = hasAuth ? `${encodedUsername}:${encodedPassword}@` : ''
	return `http://${authSegment}${normalizedHost}:${normalizedPort}`
}

function normalizeProxyWithoutScheme(
	raw: string,
	fallbackUsername?: string | null,
	fallbackPassword?: string | null
): string | null {
	const parts = raw.split(':')

	if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
		const host = parts[0]
		const port = parts[1]
		const username = parts[2]
		const password = parts.slice(3).join(':')
		if (!host || !port || !username || !password) return null
		return normalizeProxyParts(host, port, username, password)
	}

	if (parts.length === 2 && /^\d+$/.test(parts[1])) {
		return normalizeProxyParts(parts[0], parts[1], fallbackUsername, fallbackPassword)
	}

	return null
}

function normalizeProxyFromUrl(
	raw: string,
	fallbackUsername?: string | null,
	fallbackPassword?: string | null
): string | null {
	try {
		const url = new URL(raw)
		const protocol = url.protocol.toLowerCase()

		if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'socks5:') {
			return null
		}

		if (!url.username && fallbackUsername) {
			url.username = fallbackUsername
			url.password = fallbackPassword ?? ''
		}

		return url.toString()
	} catch {
		return null
	}
}

export function normalizeProxyUrl(
	input?: string | null,
	fallbackUsername?: string | null,
	fallbackPassword?: string | null
): string | null {
	const raw = input?.trim()
	if (!raw) return null

	if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)) {
		return normalizeProxyFromUrl(raw, fallbackUsername, fallbackPassword)
	}

	return normalizeProxyWithoutScheme(raw, fallbackUsername, fallbackPassword)
}

export function resolveExchangeProxy(_proxy?: string | null): string | null {
	const envProxy = process.env.EXCHANGE_PROXY_URL
	const envUsername = process.env.EXCHANGE_PROXY_USERNAME
	const envPassword = process.env.EXCHANGE_PROXY_PASSWORD
	return normalizeProxyUrl(envProxy, envUsername, envPassword)
}

function getProxyAgent(proxyUrl: string): ProxyAgent {
	const cached = proxyAgentCache.get(proxyUrl)
	if (cached) return cached

	const created = new ProxyAgent(proxyUrl)
	proxyAgentCache.set(proxyUrl, created)
	return created
}

export async function fetchExchange(
	url: string,
	options: FetchExchangeOptions = {}
): Promise<Response> {
	const { proxy, ...rest } = options
	const proxyUrl = resolveExchangeProxy(proxy)

	if (!proxyUrl) {
		return fetch(url, rest)
	}

	const init: RequestInit & { dispatcher?: Dispatcher } = {
		...rest,
		dispatcher: getProxyAgent(proxyUrl),
	}

	return fetch(url, init)
}
