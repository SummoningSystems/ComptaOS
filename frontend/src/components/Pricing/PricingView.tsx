import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { api } from "../../api/client";

interface Plan {
  id: string;
  name: string;
  price: number;
  priceLabel: string;
  period: string | null;
  description: string;
  highlighted: boolean;
  cta: string;
  ctaUrl: string;
  note: string;
  features: string[];
  locked: string[];
}

interface License {
  plan: string;
  licenseKey: string | null;
  email: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
}

const PLAN_COLORS: Record<string, string> = {
  free: "border-vscode-border",
  pro: "border-blue-500",
  pro_plus: "border-yellow-400",
};

const PLAN_BADGE: Record<string, string> = {
  free: "bg-vscode-panel text-vscode-muted",
  pro: "bg-blue-600 text-white",
  pro_plus: "bg-yellow-500 text-black",
};

export function PricingView() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [license, setLicense] = useState<License | null>(null);
  const [loading, setLoading] = useState(true);
  const [stripeConfigured, setStripeConfigured] = useState(false);

  // Activation licence manuelle
  const [activateKey, setActivateKey] = useState("");
  const [activateEmail, setActivateEmail] = useState("");
  const [activateMsg, setActivateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [activating, setActivating] = useState(false);

  // Checkout Stripe
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState<"pro" | "pro_plus" | null>(null);

  // Vérification après retour Stripe
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Waitlist
  const [waitEmail, setWaitEmail] = useState("");
  const [waitPlan, setWaitPlan] = useState("pro_plus");
  const [waitMsg, setWaitMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [waitCount, setWaitCount] = useState<number | null>(null);
  const [waitLoading, setWaitLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Plan[]>("/license/plans"),
      api.get<License>("/license"),
      api.get<{ count: number }>("/waitlist/count"),
      api.get<{ configured: boolean }>("/stripe/status").catch(() => ({ data: { configured: false } })),
    ]).then(([p, l, w, s]) => {
      setPlans(p.data);
      setLicense(l.data);
      setWaitCount(w.data.count);
      setStripeConfigured(s.data.configured);
    }).finally(() => setLoading(false));

    // Détecter retour Stripe (?session_id=...)
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (sessionId) {
      window.history.replaceState({}, "", window.location.pathname);
      setVerifying(true);
      api.get<{ paid: boolean; plan?: string; license?: { key: string; email: string } }>(
        `/stripe/verify?session_id=${sessionId}`
      ).then(({ data }) => {
        if (data.paid && data.license) {
          setVerifyMsg({
            ok: true,
            text: `✅ Paiement confirmé ! Votre licence ${data.plan === "pro_plus" ? "Pro+" : "Pro"} a été activée automatiquement.`,
          });
          return api.get<License>("/license").then(({ data: lic }) => setLicense(lic));
        }
      }).catch(() => {
        setVerifyMsg({ ok: false, text: "Impossible de vérifier le paiement. Utilisez votre clé reçue par email." });
      }).finally(() => setVerifying(false));
    }
  }, []);

  async function handleCheckout(plan: "pro" | "pro_plus") {
    setCheckoutLoading(plan);
    try {
      const { data } = await api.post<{ url: string }>("/stripe/checkout", {
        plan,
        email: checkoutEmail || undefined,
        successUrl: window.location.href,
        cancelUrl: window.location.href,
      });
      window.location.href = data.url;
    } catch (err: unknown) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : "Erreur Stripe";
      setActivateMsg({ ok: false, text: msg ?? "Erreur" });
      setCheckoutLoading(null);
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setActivating(true);
    setActivateMsg(null);
    try {
      const { data } = await api.post<License>("/license/activate", {
        key: activateKey,
        email: activateEmail,
      });
      setLicense(data);
      setActivateMsg({ ok: true, text: `Licence ${data.plan === "pro_plus" ? "Pro+" : "Pro"} activée avec succès !` });
      setActivateKey("");
      setActivateEmail("");
    } catch (err: unknown) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : "Erreur inconnue";
      setActivateMsg({ ok: false, text: msg ?? "Erreur inconnue" });
    } finally {
      setActivating(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm("Désactiver la licence ? Vous reviendrez au plan Gratuit.")) return;
    await api.post("/license/deactivate");
    const { data } = await api.get<License>("/license");
    setLicense(data);
  }

  async function handleWaitlist(e: React.FormEvent) {
    e.preventDefault();
    setWaitLoading(true);
    setWaitMsg(null);
    try {
      const { data } = await api.post<{ ok: boolean; message: string }>("/waitlist", {
        email: waitEmail,
        plan: waitPlan,
        source: "pricing_view",
      });
      setWaitMsg({ ok: data.ok, text: data.message });
      setWaitEmail("");
      setWaitCount((c) => (c !== null ? c + 1 : 1));
    } catch (err: unknown) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : "Erreur";
      setWaitMsg({ ok: false, text: msg ?? "Erreur" });
    } finally {
      setWaitLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-muted text-sm">
        Chargement…
      </div>
    );
  }

  const currentPlan = license?.plan ?? "free";

  return (
    <div className="overflow-auto h-full bg-vscode-bg text-vscode-text p-6">
      {/* Header */}
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">ComptaOS — Plans &amp; Licence</h1>
          <p className="text-vscode-muted text-sm">
            Vos données vous appartiennent. Choisissez le plan adapté à vos besoins.
          </p>
          {license && license.plan !== "free" && (
            <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-vscode-panel border border-vscode-border text-xs">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PLAN_BADGE[currentPlan]}`}>
                {currentPlan === "pro_plus" ? "PRO+" : currentPlan.toUpperCase()}
              </span>
              <span className="text-vscode-muted">
                Activé — {license.email}
              </span>
              <button
                onClick={handleDeactivate}
                className="text-red-400 hover:text-red-300 ml-2"
              >
                Désactiver
              </button>
            </div>
          )}
        </div>

        {/* Bannière vérification retour Stripe */}
        {(verifying || verifyMsg) && (
          <div className={`rounded-lg px-4 py-3 text-sm border ${verifyMsg?.ok ? "bg-green-900/20 border-green-700 text-green-300" : "bg-vscode-panel border-vscode-border text-vscode-muted"}`}>
            {verifying ? "⏳ Vérification du paiement en cours…" : verifyMsg?.text}
          </div>
        )}

        {/* Plans */}
        {stripeConfigured && currentPlan === "free" && (
          <div className="flex items-center gap-2">
            <input
              type="email"
              value={checkoutEmail}
              onChange={(e) => setCheckoutEmail(e.target.value)}
              placeholder="votre@email.com (pour recevoir la clé)"
              className="flex-1 bg-vscode-panel border border-vscode-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-vscode-accent"
            />
            <span className="text-[10px] text-vscode-muted">← votre email pour le reçu</span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          {plans.map((plan) => {
            const isActive = currentPlan === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-lg border-2 p-5 flex flex-col gap-3 bg-vscode-panel
                  ${plan.highlighted ? "border-yellow-400 shadow-lg shadow-yellow-900/20" : PLAN_COLORS[plan.id]}
                  ${isActive ? "ring-2 ring-green-500" : ""}`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-yellow-400 text-black text-[11px] font-bold rounded-full">
                    ⭐ RECOMMANDÉ
                  </div>
                )}
                {isActive && (
                  <div className="absolute -top-3 right-3 px-2 py-0.5 bg-green-600 text-white text-[10px] font-bold rounded-full">
                    ✓ ACTIF
                  </div>
                )}

                <div>
                  <h2 className="text-base font-bold">{plan.name}</h2>
                  <p className="text-vscode-muted text-xs mt-0.5">{plan.description}</p>
                </div>

                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold">{plan.priceLabel}</span>
                  {plan.period && (
                    <span className="text-vscode-muted text-xs">/{plan.period}</span>
                  )}
                </div>

                <ul className="flex flex-col gap-1.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-vscode-text">
                      <span className="text-green-400 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                  {plan.locked.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-vscode-muted line-through">
                      <span className="mt-0.5">✗</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {plan.note && (
                  <p className="text-[10px] text-vscode-muted italic border-t border-vscode-border pt-2">
                    {plan.note}
                  </p>
                )}

                {/* CTA */}
                {plan.id === "free" ? (
                  <a
                    href={plan.ctaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 text-center text-xs font-semibold py-2 px-4 rounded transition-colors bg-vscode-border text-vscode-text hover:bg-vscode-bg"
                  >
                    {isActive ? "✓ Plan actif" : plan.cta}
                  </a>
                ) : (
                  /* Pro / Pro+ : waitlist comme CTA principal */
                  <div className="flex flex-col gap-1.5 mt-2">
                    {isActive ? (
                      <div className="text-center text-xs font-semibold py-2 px-4 rounded bg-green-700/30 text-green-300 border border-green-700/50">
                        ✓ Plan actif
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setWaitPlan(plan.id);
                            document.getElementById("waitlist-section")?.scrollIntoView({ behavior: "smooth" });
                          }}
                          className={`text-center text-xs font-semibold py-2 px-4 rounded transition-colors w-full
                            ${plan.highlighted
                              ? "bg-yellow-400 text-black hover:bg-yellow-300"
                              : "bg-blue-600 text-white hover:bg-blue-500"
                            }`}
                        >
                          🔔 Accès anticipé (−30 %)
                        </button>
                        {stripeConfigured && (
                          <button
                            onClick={() => handleCheckout(plan.id as "pro" | "pro_plus")}
                            disabled={checkoutLoading !== null}
                            className="text-center text-[10px] py-1 px-3 rounded border border-vscode-border text-vscode-muted hover:text-vscode-text hover:border-vscode-text transition-colors disabled:opacity-50"
                          >
                            {checkoutLoading === plan.id ? "Redirection…" : "Acheter maintenant"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Activer une licence */}
        {currentPlan === "free" && (
          <div className="bg-vscode-panel border border-vscode-border rounded-lg p-5 mb-6">
            <h2 className="text-sm font-bold mb-1">Activer une clé de licence</h2>
            <p className="text-xs text-vscode-muted mb-4">
              Vous avez acheté ComptaOS Pro ou Pro+ ? Entrez votre clé pour débloquer les fonctionnalités.
            </p>
            <form onSubmit={handleActivate} className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={activateEmail}
                onChange={(e) => setActivateEmail(e.target.value)}
                placeholder="votre@email.com"
                required
                className="flex-1 bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-vscode-accent"
              />
              <input
                type="text"
                value={activateKey}
                onChange={(e) => setActivateKey(e.target.value)}
                placeholder="PRO-XXXX-XXXX-XXXX"
                required
                className="flex-1 bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-vscode-accent uppercase"
              />
              <button
                type="submit"
                disabled={activating}
                className="bg-vscode-accent text-white text-xs px-4 py-1.5 rounded hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {activating ? "Activation…" : "Activer"}
              </button>
            </form>
            {activateMsg && (
              <p className={`mt-2 text-xs ${activateMsg.ok ? "text-green-400" : "text-red-400"}`}>
                {activateMsg.text}
              </p>
            )}
          </div>
        )}

        {/* Waitlist */}
        <div id="waitlist-section" className="bg-vscode-panel border border-yellow-700/40 rounded-lg p-5">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-sm font-bold">🚀 Liste d'attente — lancement anticipé</h2>
            {waitCount !== null && waitCount > 0 && (
              <span className="text-xs text-vscode-muted bg-vscode-bg px-2 py-0.5 rounded-full border border-vscode-border">
                {waitCount} inscrits
              </span>
            )}
          </div>
          <p className="text-xs text-vscode-muted mb-4">
            Inscrivez-vous pour être notifié en priorité et bénéficier d'un tarif de lancement (−30 %).
          </p>
          <form onSubmit={handleWaitlist} className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={waitEmail}
              onChange={(e) => setWaitEmail(e.target.value)}
              placeholder="votre@email.com"
              required
              className="flex-1 bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs focus:outline-none focus:border-vscode-accent"
            />
            <select
              value={waitPlan}
              onChange={(e) => setWaitPlan(e.target.value)}
              className="bg-vscode-bg border border-vscode-border rounded px-3 py-1.5 text-xs focus:outline-none"
            >
              <option value="pro">Pro (79 €)</option>
              <option value="pro_plus">Pro+ (9 €/mois)</option>
            </select>
            <button
              type="submit"
              disabled={waitLoading}
              className="bg-yellow-500 text-black text-xs px-4 py-1.5 rounded hover:bg-yellow-400 disabled:opacity-50 font-semibold whitespace-nowrap"
            >
              {waitLoading ? "Inscription…" : "S'inscrire"}
            </button>
          </form>
          {waitMsg && (
            <p className={`mt-2 text-xs ${waitMsg.ok ? "text-green-400" : "text-red-400"}`}>
              {waitMsg.text}
            </p>
          )}
        </div>

        {/* Note légale */}
        <p className="text-center text-[10px] text-vscode-muted mt-6">
          ComptaOS n'est pas un logiciel de comptabilité certifié. Conçu comme outil de pilotage et de préparation.
          Pour les déclarations officielles, consultez un expert-comptable agréé.
        </p>
      </div>
    </div>
  );
}
