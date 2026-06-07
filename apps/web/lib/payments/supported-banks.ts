/**
 * lib/payments/supported-banks.ts
 *
 * Hardcoded list of Nigerian banks supported for creator payouts.
 *
 * This list is static — do not query the Paystack API for bank listings.
 * Display in the order defined here.
 *
 * The bank_code is transmitted to the Paystack API; it is never shown
 * directly to the user.
 */

export interface SupportedBank {
  readonly name: string;
  readonly code: string;
}

export const SUPPORTED_NIGERIAN_BANKS: readonly SupportedBank[] = [
  { name: 'Opay',                               code: '999992' },
  { name: 'PalmPay',                            code: '999991' },
  { name: 'MoniePoint',                         code: '50515'  },
  { name: 'MTN Momo',                           code: '120003' },
  { name: 'Access Bank',                        code: '044'    },
  { name: 'Citi Bank',                          code: '023'    },
  { name: 'Ecobank',                            code: '050'    },
  { name: 'FCMB (First City Monument Bank)',    code: '214'    },
  { name: 'Fidelity Bank',                      code: '070'    },
  { name: 'First Bank of Nigeria (FBN)',        code: '011'    },
  { name: 'Globus Bank',                        code: '00103'  },
  { name: 'Guaranty Trust Bank (GTBank)',       code: '058'    },
  { name: 'JAIZ Bank',                          code: '301'    },
  { name: 'Keystone Bank',                      code: '082'    },
  { name: 'Kuda Bank',                          code: '50211'  },
  { name: 'Lotus Bank',                         code: '303'    },
  { name: 'Optimus Bank',                       code: '107'    },
  { name: 'Parallex Bank',                      code: '104'    },
  { name: 'Polaris Bank',                       code: '076'    },
  { name: 'Premium Trust Bank',                 code: '105'    },
  { name: 'Providus Bank',                      code: '101'    },
  { name: 'Rand Merchant Bank',                 code: '502'    },
  { name: 'Signature Bank',                     code: '106'    },
  { name: 'StanbicIBTC Bank',                   code: '221'    },
  { name: 'Standard Chartered Bank',            code: '068'    },
  { name: 'Sterling Bank',                      code: '232'    },
  { name: 'Suntrust Bank',                      code: '100'    },
  { name: 'Taj Bank',                           code: '302'    },
  { name: 'Titan Trust Bank',                   code: '102'    },
  { name: 'Union Bank',                         code: '032'    },
  { name: 'United Bank for Africa (UBA)',       code: '033'    },
  { name: 'Unity Bank',                         code: '215'    },
  { name: 'Wema Bank',                          code: '035'    },
  { name: 'Zenith Bank Plc',                    code: '057'    },
] as const;

/** Lookup a bank by its code. Returns undefined if not found. */
export function getBankByCode(code: string): SupportedBank | undefined {
  return SUPPORTED_NIGERIAN_BANKS.find((b) => b.code === code);
}
