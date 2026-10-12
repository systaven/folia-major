import type { ProviderAccountSummary } from '../../../types/onlineMusic';

// src/library/core/model/onlineProviderAccountView.ts
// 在线 provider 的账户视图（纯规则）：首页与账户切换器共用。P3.3 从 components/app/home 挪进 core，
// 任何 suite 的首页都按它决定显示列表、登录入口还是「无账户」面板。

/** `accountless`: a provider without an account or public library; `public` exposes a library without login. */
export type OnlineProviderAccountView = 'resolving' | 'guest' | 'authenticated' | 'accountless' | 'public';

const isAccountless = (provider: ProviderAccountSummary | undefined) => provider?.requiresAccount === false;

// Keeps an unresolved account distinct from a confirmed anonymous session during startup hydration.
// Resolve providers without login before interpreting an unknown account status as pending hydration.
export const resolveOnlineProviderAccountView = ({
    provider,
    hasUser,
    platformAvailable,
}: {
    provider?: ProviderAccountSummary;
    hasUser: boolean;
    platformAvailable: boolean;
}): OnlineProviderAccountView => {
    if (isAccountless(provider)) return provider?.hasPublicLibrary ? 'public' : 'accountless';
    if (hasUser) return 'authenticated';
    if (platformAvailable && (provider?.hydration === 'loading' || provider?.status === 'unknown')) return 'resolving';
    return 'guest';
};

/** Whether picking the provider switches to it now (signed in, or nothing to sign in to) rather than starting a login. */
export const canSwitchToProviderDirectly = (provider: ProviderAccountSummary): boolean => (
    provider.status === 'authenticated' || isAccountless(provider)
);
