// frontend/src/scripts/cookie-consent.ts
// CookieConsent v3 és Google Consent Mode v2 integráció.

declare const CookieConsent: any;

export function updateGtmConsent(categories: string[]): void {
  const analyticsConsent = categories.includes('analytics') ? 'granted' : 'denied';
  const marketingConsent = categories.includes('marketing') ? 'granted' : 'denied';

  if (typeof (window as any).gtag === 'function') {
    (window as any).gtag('consent', 'update', {
      'analytics_storage': analyticsConsent,
      'ad_storage': marketingConsent,
      'ad_user_data': marketingConsent,
      'ad_personalization': marketingConsent,
    });
  }
}

export async function initCookieConsent(): Promise<void> {
  try {
    // @ts-ignore
    await import('https://cdn.jsdelivr.net/gh/orestbida/cookieconsent@v3.0.0/dist/cookieconsent.umd.js');

    if (typeof CookieConsent === 'undefined') return;

    const toggleScroll = (isShown: boolean) => {
      document.documentElement.style.overflow = isShown ? 'hidden' : '';
    };

    CookieConsent.run({
      guiOptions: {
        consentModal: {
          layout: "box",
          position: "bottom left",
          equalWeightButtons: true,
          flipButtons: false
        },
        preferencesModal: {
          layout: "box",
          position: "right",
          equalWeightButtons: true,
          flipButtons: false
        }
      },
      categories: {
        necessary: { readOnly: true },
        analytics: {},
        marketing: {}
      },
      language: {
        default: "hu",
        autoDetect: "browser",
        translations: {
          hu: {
            consentModal: {
              title: "Az oldal sütiket használ",
              description: "Weboldalunk sütiket használ a működés biztosítása, az analitika és a célzott marketing érdekében.",
              acceptAllBtn: "Mind elfogadása",
              acceptNecessaryBtn: "Csak szükségesek",
              showPreferencesBtn: "Testreszabás"
            },
            preferencesModal: {
              title: "Süti (Cookie) Beállítások",
              acceptAllBtn: "Mind elfogadása",
              acceptNecessaryBtn: "Csak szükségesek",
              savePreferencesBtn: "Beállítások mentése",
              closeIconLabel: "Bezárás",
              sections: [
                {
                  title: "Süti Használat",
                  description: "Itt testreszabhatja a sütik kategóriáit."
                },
                {
                  title: "Szigorúan Szükséges Sütik <span class=\"pm__badge\">Mindig aktív</span>",
                  description: "Ezek a sütik a weboldal alapvető működéséhez szükségesek, például a bejelentkezéshez (localStorage).",
                  linkedCategory: "necessary"
                },
                {
                  title: "Analitikai Sütik",
                  description: "Ezek a sütik segítenek nekünk megérteni, hogyan használják a látogatók a weboldalt.",
                  linkedCategory: "analytics"
                },
                {
                  title: "Marketing Sütik",
                  description: "Ezek a sütik hirdetések személyre szabásához szükségesek (Google Ads).",
                  linkedCategory: "marketing"
                }
              ]
            }
          }
        }
      },
      onFirstConsent: ({ cookie }: any) => updateGtmConsent(cookie.categories),
      onConsent: ({ cookie }: any) => updateGtmConsent(cookie.categories),
      onChange: ({ cookie }: any) => updateGtmConsent(cookie.categories),
      onModalShow: () => toggleScroll(true),
      onModalHide: () => toggleScroll(false)
    });
  } catch (err) {
    console.warn("CookieConsent betöltési hiba:", err);
  }
}
