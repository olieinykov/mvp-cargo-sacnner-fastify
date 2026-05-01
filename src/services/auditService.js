import hazmatTable from '../data/hazmat_data.json' with { type: 'json' };
import { HAZMAT_PLACARD_RULES } from '../data/placard_data.js';
import { getLevenshteinDistance } from '../utils/helpers.js';

// ==========================
// Audit logic — Rules Engine
// ==========================

/**
 * Severity levels (per spec):
 *   CRITICAL — OOS-level violation, must fix before departure
 *   MAJOR    — likely fine, strong recommendation to fix
 *   MINOR    — technical violation, warning-level
 *   WARNING  — best-practice recommendation, not a violation
 */

// 49 CFR 177.848 — forbidden segregation pairs by hazard class.
// Each entry means: class A cannot be loaded with class B.

const FORBIDDEN_COMBINATIONS = [
	['2.1', '2.3'],
	['3', '2.3'],
	['4.1', '2.3'],
	['4.2', '2.3'],
	['4.3', '2.3'],
	['5.1', '2.3'],
	['5.2', '2.3'],
	['4.2', '8'],
	['1', '2.1'],
	['1', '2.2'],
	['1', '2.3'],
	['1', '3'],
	['1', '4.1'],
	['1', '4.2'],
	['1', '4.3'],
	['1', '5.1'],
	['1', '5.2'],
	['1', '6.1'],
	['1', '8'],
];

// Placard recommendation map: hazard class → human-readable placard description
const PLACARD_MAP = {
	1: 'Class 1 EXPLOSIVE (orange placard)',
	1.1: 'Division 1.1 EXPLOSIVE (orange placard)',
	1.2: 'Division 1.2 EXPLOSIVE (orange placard)',
	1.3: 'Division 1.3 EXPLOSIVE (orange placard)',
	1.4: 'Division 1.4 EXPLOSIVE (orange placard)',
	1.5: 'Division 1.5 EXPLOSIVE (orange placard)',
	1.6: 'Division 1.6 EXPLOSIVE (orange placard)',
	2.1: 'Class 2.1 FLAMMABLE GAS (red placard)',
	2.2: 'Class 2.2 NON-FLAMMABLE GAS (green placard)',
	2.3: 'Class 2.3 POISON GAS (white placard)',
	3: 'Class 3 FLAMMABLE LIQUID (red placard)',
	4.1: 'Class 4.1 FLAMMABLE SOLID (red-and-white striped placard)',
	4.2: 'Class 4.2 SPONTANEOUSLY COMBUSTIBLE (red-and-white placard)',
	4.3: 'Class 4.3 DANGEROUS WHEN WET (blue placard)',
	5.1: 'Class 5.1 OXIDIZER (yellow placard)',
	5.2: 'Class 5.2 ORGANIC PEROXIDE (yellow/red placard)',
	6.1: 'Class 6.1 POISON (white placard)',
	6.2: 'Class 6.2 INFECTIOUS SUBSTANCE (white placard)',
	7: 'Class 7 RADIOACTIVE (yellow/white placard)',
	8: 'Class 8 CORROSIVE (black-and-white placard)',
	9: 'Class 9 MISCELLANEOUS (black-and-white striped placard)',
};

const LARGE_SINGLE_UN_THRESHOLD_LBS = 8820;

const isForbiddenCombination = (classA, classB) => {
	return FORBIDDEN_COMBINATIONS.some(
		([a, b]) => (a === classA && b === classB) || (a === classB && b === classA),
	);
};

/**
 * Returns the total aggregated weight (lbs) for all UN entries that belong to
 * a given hazard class, using the hazardClass field now returned by bolHelper.
 */
const getWeightForClass = (targetClass, bolWeights) => {
	if (!bolWeights || bolWeights.length === 0) return 0;
	const norm = (s) =>
		s
			? String(s)
					.trim()
					.toLowerCase()
					.replace(/^class\s+/, '')
			: null;
	const target = norm(String(targetClass));
	return bolWeights.reduce((sum, entry) => {
		if (norm(String(entry.hazardClass ?? '')) === target) {
			return sum + (Number(entry.weight) || 0);
		}
		return sum;
	}, 0);
};

/**
 * Determines whether an exterior placard is required for a given class based on weight rules.
 * Returns true if the placard MUST be present.
 */
const isPlacardsRequired = (hazardClass, bolWeights) => {
	const norm = (s) =>
		s
			? String(s)
					.trim()
					.toLowerCase()
					.replace(/^class\s+/, '')
			: null;
	const cls = norm(String(hazardClass));

	// Find rule — try exact match, then base class (e.g. '1.4' → '1')
	const rule = HAZMAT_PLACARD_RULES[cls] ?? HAZMAT_PLACARD_RULES[cls?.split('.')[0]];

	if (!rule) return false; // unknown class — don't require
	if (rule.placard === 'NOT_REQUIRED_DOMESTIC') return false;
	if (rule.placard === 'ANY_QUANTITY') return true;
	if (rule.placard === 'OVER_1001_LBS') {
		return getWeightForClass(cls, bolWeights) >= 1001;
	}
	// DEPENDS_ON_PIH / DEPENDS_ON_TYPE — treat as Table 2 for standard LTL
	if (rule.placard === 'DEPENDS_ON_PIH' || rule.placard === 'DEPENDS_ON_TYPE') {
		return getWeightForClass(cls, bolWeights) >= 1001;
	}
	return false;
};

/**
 * Determines whether a UN number must appear on an exterior placard.
 * Returns true only for PIH materials or a large single-UN shipment.
 */
const isUNNumberRequiredOnPlacard = (unNumber, bolWeights) => {
	if (!bolWeights || bolWeights.length === 0) return false;
	const cleanUN = String(unNumber).replace(/\D/g, '');
	if (cleanUN.length !== 4) return false;

	// Find this UN entry in bolWeights (now carries hazardClass directly)
	const entry = bolWeights.find((e) => String(e.unNumber).replace(/\D/g, '') === cleanUN);
	if (!entry) return false;

	const cls = String(entry.hazardClass ?? '').trim();
	const rule = HAZMAT_PLACARD_RULES[cls] ?? HAZMAT_PLACARD_RULES[cls.split('.')[0]];

	// PIH: Poison Gas (2.3) or Class 6.1 PIH — always needs UN# on exterior placard
	if (rule?.unNumber === 'ALWAYS_PIH' || rule?.unNumber === 'ALWAYS_PIH_OR_LARGE_SINGLE') {
		return true;
	}

	if (entry.isBulk === true) {
		return true;
	}

	// BULK_OR_LARGE_SINGLE: only require UN# if this is the sole hazmat UN and weight > threshold
	const allHazmatEntries = bolWeights.filter(
		(e) => String(e.unNumber).replace(/\D/g, '').length === 4,
	);
	if (
		allHazmatEntries.length === 1 &&
		(Number(entry.weight) || 0) > LARGE_SINGLE_UN_THRESHOLD_LBS
	) {
		return true;
	}

	return false;
};

const recommendPlacards = (classes, bolWeights) => {
	const recommendations = [];
	for (const cls of classes) {
		if (isPlacardsRequired(cls, bolWeights)) {
			const label = PLACARD_MAP[cls];
			if (label) recommendations.push(label);
		}
	}
	return recommendations;
};

export const runAudit = (
	bolResults,
	markerResults,
	cargoResults,
	isGlobalHazmat,
	bolWeights,
	sealResults,
) => {
	const issues = [];

	// Convenience: get mainValue safely
	const v = (field) => field?.mainValue ?? null;

	// Normalise a single class string (trim, lowercase, strip "class " prefix)
	const norm = (s) =>
		s
			? String(s)
					.trim()
					.toLowerCase()
					.replace(/^class\s+/, '')
			: null;

	// Normalise a single UN/NA number: strip "UN"/"NA" prefix, keep only digits
	const normUN = (s) =>
		s
			? String(s)
					.trim()
					.replace(/^(un|na)/i, '')
					.trim()
			: null;

	// Parse a class field that may contain multiple values like "Class 8, Class 3" or "3 / 8".
	// Returns an array of normalised non-empty class strings.
	const parseClasses = (raw) => {
		if (!raw) return [];
		return String(raw)
			.split(/[\s,;/|&+()+]+/)
			.map((token) => norm(token.trim()))
			.filter((token) => token && /^\d/.test(token));
	};

	// Parse a UN field that may contain multiple values like "UN1170, UN1993" or "1170/1993".
	// Returns an array of normalised digit-only strings.
	const parseUNs = (raw) => {
		if (!raw) return [];
		return String(raw)
			.split(/[\s,;/|&+()+]+/)
			.map((token) => normUN(token.trim()))
			.filter((token) => token && /^\d{4}$/.test(token));
	};

	// Helper to check if a specific subclass matches a base class on a placard/label
	const isClassMatch = (cls1, cls2) => {
		if (cls1 === cls2) return true;

		const base1 = String(cls1).split('.')[0];
		const base2 = String(cls2).split('.')[0];

		if (cls1 === base2 || cls2 === base1) return true;

		return false;
	};

	// Helper to add an issue only if not already present (same cfr + check + message)
	const addIssue = (issue) => {
		const dup = issues.some(
			(i) => i.cfr === issue.cfr && i.check === issue.check && i.message === issue.message,
		);
		if (!dup) issues.push(issue);
	};

	const noBolHasUN = bolResults.every((bol) => parseUNs(v(bol.extracted?.unNumber)).length === 0);

	// ─────────────────────────────────────────────
	// 0. GLOBAL HAZMAT SPLIT
	// ─────────────────────────────────────────────

	if (!isGlobalHazmat) {
		// ── FALSE PLACARDING CHECK (49 CFR 171.2(k)) ──────────────────────────
		// Shipment is declared non-hazmat. If the AI found hazmat placards on the
		// trailer or hazmat diamond labels on cargo, that is a critical violation.
		const hasPlacardOnTruck = markerResults.some((m) => {
			const cls = v(m.extracted?.hazardClass);
			return cls !== null && String(cls).trim() !== '';
		});
		const hasDiamondOnCargo = cargoResults.some((c) => {
			const cls = v(c.extracted?.hazardClass);
			return cls !== null && String(cls).trim() !== '';
		});
		if (hasPlacardOnTruck || hasDiamondOnCargo) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 171.2(k)',
				check: 'False Placarding',
				message:
					'Shipment is declared as non-hazardous on the BOL, but hazmat placards or hazard class labels were detected on the vehicle or cargo. Displaying hazmat placards on a non-hazmat shipment is a federal violation.',
				fix: 'If this shipment IS hazardous, update the BOL accordingly. If it is not, remove all hazmat placards and labels before departure.',
			});
		}
	} else {
		// ─────────────────────────────────────────────
		// 1. BOL FIELD VALIDATION — "at least one BOL satisfies" logic (49 CFR 172.200–204)
		// An issue is raised only if NO BOL image satisfies the condition.
		// ─────────────────────────────────────────────

		if (noBolHasUN) {
			addIssue({
				source: 'BOL',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.202(a)(1)',
				check: 'UN Number',
				message: 'UN/NA identification number is missing from all BOL documents.',
				fix: 'Add the UN/NA number (e.g. UN1170) to the hazmat entry on the BOL.',
			});
		}

		{
			for (const bol of bolResults) {
				const bolExt = bol.extracted ?? {};
				const bolUNs = parseUNs(v(bolExt.unNumber));

				for (const unNum of bolUNs) {
					const cleanUnNum = String(unNum).replace(/\D/g, '');

					if (cleanUnNum.length !== 4) continue;

					const rawEntry = hazmatTable?.[`UN${cleanUnNum}`];
					if (!rawEntry) continue;

					const entryList = Array.isArray(rawEntry) ? rawEntry : [rawEntry];

					const bolPGForLookup = v(bolExt.packingGroup);
					const normalizedPGForLookup = bolPGForLookup
						? String(bolPGForLookup).toUpperCase().replace(/[^IV]/g, '')
						: null;

					const entry =
						(normalizedPGForLookup &&
							entryList.find(
								(e) =>
									String(e.expectedData?.packingGroup ?? '').toUpperCase() ===
									normalizedPGForLookup,
							)) ??
						entryList[0];

					if (!entry) continue;

					const expected = entry.expectedData ?? {};
					const errors = entry.errors ?? {};
					const refs = entry.references ?? {};

					// ── 1. Hazard Class ──────────────────────────────────────────
					const bolClassArr = parseClasses(v(bolExt.hazardClass));
					if (
						expected.hazardClass != null &&
						bolClassArr.length > 0 &&
						!bolClassArr.some((c) =>
							isClassMatch(c, norm(String(expected.hazardClass))),
						)
					) {
						addIssue({
							source: 'BOL',
							severity: 'CRITICAL',
							cfr: '49 CFR 172.101',
							check: 'Hazard Class',
							message:
								errors.hazardClassMismatch ??
								`UN${unNum}: hazard class mismatch. BOL shows ${bolClassArr.join('/')}, expected ${expected.hazardClass}.`,
							fix: `Correct the hazard class to "${expected.hazardClass}" per the DOT Hazardous Materials Table.`,
						});
					}

					// ── 2. Packing Group ─────────────────────────────────────────
					const bolPG = v(bolExt.packingGroup);
					const normalizedPG = bolPG ? String(bolPG).trim().toUpperCase() : null;
					if (
						expected.packingGroup != null &&
						normalizedPG &&
						normalizedPG !== '—' &&
						normalizedPG !== '-' &&
						normalizedPG !== expected.packingGroup.toUpperCase()
					) {
						addIssue({
							source: 'BOL',
							severity: 'CRITICAL',
							cfr: '49 CFR 172.101',
							check: 'Packing Group',
							message:
								errors.packingGroupMismatch ??
								`UN${unNum}: packing group mismatch. BOL shows PG ${normalizedPG}, expected PG ${expected.packingGroup}.`,
							fix: `Correct the packing group to "${expected.packingGroup}" per the DOT Hazardous Materials Table.`,
						});
					}

					// ── 3. Proper Shipping Name ───────────────────────────────────
					const bolPSN = v(bolExt.properShippingName);
					const expectedPSN = expected.properShippingName;

					if (expectedPSN != null && bolPSN != null && typeof bolPSN === 'string') {
						const normPSN = (str) => {
							return str
								.toLowerCase()
								.replace(/\s*\(.*?\)\s*/g, ' ')
								.replace(/\bn\.?o\.?s\.?\b/gi, 'nos')
								.replace(/[-/]/g, ' ')
								.replace(/[^a-z0-9\s]/g, '')
								.replace(/\b(liquid|solid)s\b/g, '$1')
								.replace(/\bgases\b/g, 'gas')
								.replace(/\s+/g, ' ')
								.trim();
						};

						const bolNorm = normPSN(bolPSN);
						const expNorm = normPSN(expectedPSN);

						const isMatch = bolNorm === expNorm || bolNorm.startsWith(expNorm);

						if (!isMatch) {
							addIssue({
								source: 'BOL',
								severity: 'MAJOR',
								cfr: '49 CFR 172.202(a)(1)',
								check: 'Proper Shipping Name',
								message: `UN${unNum}: proper shipping name mismatch. BOL shows "${bolPSN.trim()}", expected "${expectedPSN}".`,
								fix: `Use the exact DOT proper shipping name: "${expectedPSN}".`,
							});
						}
					}

					// ── 4. Label Codes ────────────────────────────────────────────
					if (expected.labelCodes != null) {
						const requiredLabels = parseClasses(String(expected.labelCodes));
						const bolCls = parseClasses(v(bolExt.hazardClass));
						const missingLabels = requiredLabels.filter(
							(rl) => !bolCls.some((bc) => isClassMatch(bc, rl)),
						);
						if (missingLabels.length > 0) {
							addIssue({
								source: 'BOL',
								severity: 'MAJOR',
								cfr: '49 CFR 172.400',
								check: 'Label Codes',
								message:
									errors.labelingViolation ??
									`UN${unNum}: missing or incorrect label codes on BOL. Required: ${requiredLabels.join(', ')}.`,
								fix: `Ensure all required label codes (${requiredLabels.join(', ')}) are reflected on the BOL and cargo packaging.`,
							});
						}
					}

					// ── 5. Packaging references (informational MINOR) ─────────────
					//if (refs.packagingNonBulk || refs.packagingBulk || refs.packagingExceptions) {
					//	const parts = [
					//		refs.packagingExceptions && `Exceptions § ${refs.packagingExceptions.replace('173.', '173.')}`,
					//		refs.packagingNonBulk    && `Non-bulk § ${refs.packagingNonBulk}`,
					//		refs.packagingBulk       && `Bulk § ${refs.packagingBulk}`,
					//	].filter(Boolean).join(', ');

					//	const hasPackagingViolation = v(bolExt.packagingViolation) === true;
					//	if (hasPackagingViolation) {
					//		addIssue({
					//			source:   'BOL',
					//			severity: 'MAJOR',
					//			cfr:      '49 CFR 173',
					//			check:    'Packaging Requirements',
					//			message:  errors.packagingViolation
					//				?? `UN${unNum}: packaging requirements violation. Refer to 49 CFR: ${parts}.`,
					//			fix: `Verify packaging against 49 CFR ${parts}.`,
					//		});
					//	}
					//}

					//if (refs.specialProvisions) {
					//	const hasSpecialViolation = v(bolExt.specialProvisionsViolation) === true;
					//	if (hasSpecialViolation) {
					//		addIssue({
					//			source:   'BOL',
					//			severity: 'WARNING',
					//			cfr:      '49 CFR 172.102',
					//			check:    'Special Provisions',
					//			message:  errors.specialProvisionsViolation
					//				?? `UN${unNum}: special provisions violation (${refs.specialProvisions}). See 49 CFR § 172.102.`,
					//			fix: `Review and comply with special provisions: ${refs.specialProvisions}.`,
					//		});
					//	}
					//}
				}
			}
		}

		const noBolHasClass = bolResults.every(
			(bol) => parseClasses(v(bol.extracted?.hazardClass)).length === 0,
		);
		if (noBolHasClass) {
			addIssue({
				source: 'BOL',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.202(a)(2)',
				check: 'Hazard Class',
				message: 'Hazard class / division is missing from all BOL documents.',
				fix: 'Add the numeric hazard class (e.g. "3", "8", "5.2") to the BOL entry.',
			});
		}

		const noBolHasHM = bolResults.every((bol) => !v(bol.extracted?.hmColumnMarked));
		if (noBolHasHM) {
			addIssue({
				source: 'BOL',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.201(a)(1)',
				check: 'HM Column (172.201)',
				message: 'HM column is not clearly marked with "X" or "RQ" on any BOL document.',
				fix: 'Mark "X" in the HM column next to each hazmat entry on the BOL.',
			});
		}

		const noBolHasPhone = bolResults.every((bol) => !v(bol.extracted?.emergencyPhone));
		if (noBolHasPhone) {
			addIssue({
				source: 'BOL',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.201(d)',
				check: 'Emergency Phone',
				message:
					'24-hour emergency response phone number is missing from all BOL documents.',
				fix: 'Add a monitored 24-hour emergency phone number (e.g. CHEMTREC 800-424-9300).',
			});
		}

		const noBolHasPG = bolResults.every((bol) => {
			const bolExt = bol.extracted ?? {};
			const bolClsArr = parseClasses(v(bolExt.hazardClass));
			const bolUNs = parseUNs(v(bolExt.unNumber));
			// BOL is PG-exempt if ANY of its classes is Class 2.x or Class 7
			let isPG_exempt = bolClsArr.some((c) => c.startsWith('2') || c === '7');
			if (!isPG_exempt && bolUNs.length > 0) {
				isPG_exempt = bolUNs.some((unNum) => {
					const cleanUnNum = String(unNum).replace(/\D/g, '');
					const rawEntry = hazmatTable?.[`UN${cleanUnNum}`];
					if (!rawEntry) return false;

					const entryList = Array.isArray(rawEntry) ? rawEntry : [rawEntry];
					return entryList.some((e) => e.expectedData?.packingGroup == null);
				});
			}
			if (isPG_exempt) return false; // exempt BOL — does not count as "missing"
			const pgValue = v(bolExt.packingGroup);
			return !pgValue || String(pgValue).trim() === '—' || String(pgValue).trim() === '-';
		});
		if (noBolHasPG) {
			addIssue({
				source: 'BOL',
				severity: 'MAJOR',
				cfr: '49 CFR 172.202(a)(4)',
				check: 'Packing Group',
				message:
					'Packing group (I, II, or III) is missing from all applicable BOL documents.',
				fix: 'Add the required packing group designation to the BOL hazmat entry.',
			});
		}

		const noBolHasCert = bolResults.every(
			(bol) => !v(bol.extracted?.shipperCertificationPresent),
		);
		if (noBolHasCert) {
			addIssue({
				source: 'BOL',
				severity: 'MAJOR',
				cfr: '49 CFR 172.204',
				check: 'Shipper Cert (172.204)',
				message:
					'Shipper certification signature is absent or illegible on all BOL documents.',
				fix: 'Have the shipper sign the certification statement on the BOL.',
			});
		}

		const noBolSequenceOk = bolResults.every(
			(bol) => v(bol.extracted?.entrySequenceCompliant) === false,
		);
		if (noBolSequenceOk) {
			addIssue({
				source: 'BOL',
				severity: 'MAJOR',
				cfr: '49 CFR 172.201(a)',
				check: 'Entry Sequence',
				message:
					'Hazmat entry sequence does not follow required DOT order on any BOL document (shipping name → class → UN number → packing group).',
				fix: 'Reorder the BOL hazmat entry to: Proper Shipping Name, Hazard Class, UN/NA Number, Packing Group.',
			});
		}

		// ─────────────────────────────────────────────
		// 2. PROPER SHIPPING NAME VERIFICATION (49 CFR 172.101 / 172.202)
		// ─────────────────────────────────────────────

		const noBolHasShippingName = bolResults.every((bol) => {
			const psn = v(bol.extracted?.properShippingName);
			return !psn || String(psn).trim() === '';
		});

		if (noBolHasShippingName) {
			addIssue({
				source: 'BOL',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.202(a)(1)',
				check: 'Proper Shipping Name',
				message: 'Proper shipping name is missing from all BOL documents.',
				fix: 'Add the exact DOT-authorized Proper Shipping Name from 49 CFR 172.101.',
			});
		}
	} // end isGlobalHazmat — BOL field validation

	// ─────────────────────────────────────────────
	// 3. BOL × PLACARD CROSS-MATCH — weight-aware (49 CFR 172.504 / 172.332)
	// Placards are only REQUIRED when the weight/class rules demand them.
	// UN numbers on exterior placards are only required for PIH or large single-UN loads.
	// ─────────────────────────────────────────────

	const bolClasses = [
		...new Set(bolResults.flatMap((b) => parseClasses(v(b.extracted?.hazardClass)))),
	];
	const bolUNs = [...new Set(bolResults.flatMap((b) => parseUNs(v(b.extracted?.unNumber))))];
	const placardClasses = [
		...new Set(markerResults.flatMap((m) => parseClasses(v(m.extracted?.hazardClass)))),
	];
	const placardUNs = [
		...new Set(markerResults.flatMap((m) => parseUNs(v(m.extracted?.unNumber)))),
	];

	if (isGlobalHazmat) {
		// BOL class requires a placard → check if one is present on the truck
		for (const bc of bolClasses) {
			const required = isPlacardsRequired(bc, bolWeights);
			if (!required) continue; // weight threshold not met — placard not mandatory

			if (!placardClasses.some((pc) => isClassMatch(bc, pc))) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.504(a)',
					check: 'BOL-Placard Class Match',
					message: `BOL declares Class ${bc} and the weight threshold requires a placard, but no matching placard was found on the vehicle (placard classes: ${placardClasses.join(', ') || 'none'}).`,
					fix: `Affix a Class ${bc} placard on all 4 sides of the trailer before departure.`,
				});
			}
		}

		// Placard found on truck but not declared on BOL → false placarding
		for (const pc of placardClasses) {
			if (bolClasses.length > 0 && !bolClasses.some((bc) => isClassMatch(bc, pc))) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.504(a)',
					check: 'BOL-Placard Class Match',
					message: `Placard on vehicle shows Class ${pc} but this class is not declared on any BOL (BOL classes: ${bolClasses.join(', ')}).`,
					fix: `Remove or replace the incorrect Class ${pc} placard, or update the BOL to include this class.`,
				});
			}
		}

		// ── UN number on exterior placard (49 CFR 172.332) ─────────────────
		// Required only for PIH or a single-UN large load (> 8,820 lbs).
		for (const bu of bolUNs) {
			if (!isUNNumberRequiredOnPlacard(bu, bolWeights)) continue; // not required

			if (!placardUNs.includes(bu)) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.332',
					check: 'BOL-Placard UN Match',
					message: `UN${bu} requires a UN number on the exterior placard (PIH material or large single-UN load) but was not found on any placard (placard UNs: ${placardUNs.map((u) => 'UN' + u).join(', ') || 'none'}).`,
					fix: `Ensure a placard panel displaying UN${bu} is present on all 4 sides of the trailer.`,
				});
			}
		}

		// Placard has a UN number that doesn't appear on the BOL — always an error
		for (const pu of placardUNs) {
			if (bolUNs.length > 0 && !bolUNs.includes(pu)) {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: '49 CFR 172.332',
					check: 'BOL-Placard UN Match',
					message: `UN${pu} is shown on a placard but was not found on any BOL (BOL UNs: ${bolUNs.map((u) => 'UN' + u).join(', ')}).`,
					fix: `Remove or replace the incorrect placard, or update the BOL to include UN${pu}.`,
				});
			}
			if (!isUNNumberRequiredOnPlacard(pu, bolWeights) && !noBolHasUN) {
				addIssue({
					source: 'CROSS',
					severity: 'MAJOR',
					cfr: '49 CFR 172.336(b)',
					check: 'Prohibited UN Marking',
					message: `UN${pu} is displayed on the exterior placard, but the shipment weight does not meet the 8,820 lbs threshold required to display identification numbers for non-bulk packages.`,
					fix: `Remove the UN number panel from the placard, or replace it with a standard word placard (e.g., FLAMMABLE).`,
				});
			}
		}
	}

	// ─────────────────────────────────────────────
	// 4. BOL × CARGO CROSS-MATCH — set-based (49 CFR 172.301 / 172.400)
	// ─────────────────────────────────────────────

	const cargoClasses = [
		...new Set(cargoResults.flatMap((c) => parseClasses(v(c.extracted?.hazardClass)))),
	];
	const cargoUNs = [...new Set(cargoResults.flatMap((c) => parseUNs(v(c.extracted?.unNumber))))];

	// BOL classes that have no matching cargo class
	for (const bc of bolClasses) {
		if (cargoClasses.length > 0 && !cargoClasses.some((cc) => isClassMatch(bc, cc))) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.400',
				check: 'BOL-Package Class Match',
				message: `BOL declares Class ${bc} but no cargo package label matching this class was found (cargo classes: ${cargoClasses.join(', ')}).`,
				fix: 'Ensure package labels match the hazard class declared on the BOL.',
			});
		}
	}

	// Cargo classes that have no matching BOL class
	for (const cc of cargoClasses) {
		if (bolClasses.length > 0 && !bolClasses.some((bc) => isClassMatch(bc, cc))) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.400',
				check: 'BOL-Package Class Match',
				message: `Cargo package shows Class ${cc} but this class is not declared on any BOL (BOL classes: ${bolClasses.join(', ')}).`,
				fix: 'Update the BOL to include all hazard classes present on cargo packages, or re-label the packages.',
			});
		}
	}

	// BOL UN numbers that have no matching cargo UN
	for (const bu of bolUNs) {
		if (cargoUNs.length > 0 && !cargoUNs.includes(bu)) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.301(a)',
				check: 'BOL-Package UN Match',
				message: `UN${bu} is listed on BOL but was not found on any cargo package (cargo UNs: ${cargoUNs.map((u) => 'UN' + u).join(', ')}).`,
				fix: `Ensure cargo packages are marked with UN${bu} as required.`,
			});
		}
	}
	// Cargo UN numbers that have no matching BOL UN
	for (const cu of cargoUNs) {
		if (bolUNs.length > 0 && !bolUNs.includes(cu)) {
			addIssue({
				source: 'CROSS',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.301(a)',
				check: 'BOL-Package UN Match',
				message: `UN${cu} is marked on cargo but was not found on any BOL (BOL UNs: ${bolUNs.map((u) => 'UN' + u).join(', ')}).`,
				fix: `Update the BOL to include UN${cu}, or verify the correct UN marking on cargo packages.`,
			});
		}
	}

	// Package labels check — issue only if it's a Hazmat load AND we have cargo photos,
	// but NO cargo image has labels present
	if (isGlobalHazmat && cargoResults.length > 0) {
		const noCargoHasLabels = cargoResults.every(
			(cargo) => !v(cargo.extracted?.packageLabelsPresent),
		);
		if (noCargoHasLabels) {
			addIssue({
				source: 'CARGO',
				severity: 'CRITICAL',
				cfr: '49 CFR 172.400',
				check: 'Package Labels',
				message:
					'Required hazard class labels are not visible on cargo packages in any provided photo.',
				fix: 'Affix the correct hazard class label(s) to each package as required by 49 CFR 172.400.',
			});
		}
	}

	// ─────────────────────────────────────────────
	// 5. COMPATIBILITY CHECK (49 CFR 177.848)
	// Collect all unique classes across all slots
	// ─────────────────────────────────────────────

	const allClasses = [
		...new Set([
			...bolResults.flatMap((b) => parseClasses(v(b.extracted?.hazardClass))),
			...markerResults.flatMap((m) => parseClasses(v(m.extracted?.hazardClass))),
			...cargoResults.flatMap((c) => parseClasses(v(c.extracted?.hazardClass))),
		]),
	];

	if (allClasses.length >= 2) {
		for (let i = 0; i < allClasses.length; i++) {
			for (let j = i + 1; j < allClasses.length; j++) {
				if (isForbiddenCombination(allClasses[i], allClasses[j])) {
					addIssue({
						source: 'CROSS',
						severity: 'CRITICAL',
						cfr: '49 CFR 177.848',
						check: 'Compatibility (177.848)',
						message: `Forbidden combination: Class ${allClasses[i]} and Class ${allClasses[j]} cannot be transported together per segregation table.`,
						fix: 'Separate the incompatible hazmat classes onto different trailers before departure.',
					});
				}
			}
		}
	}

	// ─────────────────────────────────────────────
	// 6. PLACARD CONDITION CHECKS — "at least one placard satisfies" logic
	// ─────────────────────────────────────────────

	const allPlacardsDamaged = markerResults.every((marker) => {
		const cond = v(marker.extracted?.placardCondition);
		return cond && cond !== 'unknown' && cond === 'damaged';
	});
	if (allPlacardsDamaged && markerResults.length > 0) {
		addIssue({
			source: 'PLACARD',
			severity: 'CRITICAL',
			cfr: '49 CFR 172.516(c)(1)',
			check: 'Placard Condition',
			message: 'All placards are damaged and may be unreadable at inspection.',
			fix: 'Replace damaged placards with new, legible ones before departure.',
		});
	} else {
		const anyPlacardBlurry = markerResults.every((marker) => {
			const cond = v(marker.extracted?.placardCondition);
			return cond && cond !== 'unknown' && (cond === 'blurry' || cond === 'damaged');
		});
		if (anyPlacardBlurry && markerResults.length > 0) {
			addIssue({
				source: 'PLACARD',
				severity: 'MINOR',
				cfr: '49 CFR 172.516(c)(1)',
				check: 'Placard Condition',
				message:
					'No clearly legible placard found — all placards are blurry, damaged or obscured.',
				fix: 'Clean or replace all placards to ensure they are fully legible.',
			});
		}
	}

	const noPlacardFourSided = markerResults.every(
		(marker) => !v(marker.extracted?.fourSidedPlacementVerified),
	);
	if (noPlacardFourSided && markerResults.length > 0) {
		addIssue({
			source: 'PLACARD',
			severity: 'WARNING',
			cfr: '49 CFR 172.504(a)',
			check: 'Four-Sided Placement',
			message:
				'Four-sided placard placement could not be verified from any of the provided photos.',
			fix: 'Submit photos of all 4 sides of the trailer to confirm placard placement.',
		});
	}

	const noPlacardCorrectOrientation = markerResults.every(
		(marker) => v(marker.extracted?.correctOrientation) === false,
	);
	if (noPlacardCorrectOrientation && markerResults.length > 0) {
		addIssue({
			source: 'PLACARD',
			severity: 'MINOR',
			cfr: '49 CFR 172.516(c)(2)',
			check: 'Placard Orientation',
			message: 'No placard appears to be in the correct point-up (diamond) orientation.',
			fix: 'Re-affix the placard(s) in the correct point-up diamond orientation.',
		});
	}

	// ─────────────────────────────────────────────
	// 7. CARGO / LOAD SECUREMENT — "at least one cargo satisfies" logic
	// ─────────────────────────────────────────────

	const noCargoSecured = cargoResults.every((cargo) => v(cargo.extracted?.loadSecured) === false);
	if (noCargoSecured && cargoResults.length > 0) {
		addIssue({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834(a)',
			check: 'Load Securement',
			message:
				'Cargo does not appear to be properly secured against shifting in any of the provided photos.',
			fix: 'Secure all cargo with appropriate tie-downs, straps, or blocking before departure.',
		});
	}

	const noCargoNoShifting = cargoResults.every(
		(cargo) => v(cargo.extracted?.noShiftingHazards) === false,
	);
	if (noCargoNoShifting && cargoResults.length > 0) {
		addIssue({
			source: 'CARGO',
			severity: 'WARNING',
			cfr: '49 CFR 177.834(a)',
			check: 'Shifting Hazards',
			message: 'Potential cargo shifting hazards detected in all provided cargo photos.',
			fix: 'Add additional tie-downs or bracing to prevent cargo movement in transit.',
		});
	}

	// ─────────────────────────────────────────────
	// SEAL VALIDATION CROSS-MATCH
	// ─────────────────────────────────────────────
	const rawBolSeals = [
		...new Set(bolResults.map((b) => v(b.extracted?.sealNumber)).filter(Boolean)),
	];
	const bolSeals = rawBolSeals.flatMap((sealStr) =>
		String(sealStr)
			.split(/[\/,|;\\]+/)
			.map((s) => s.trim())
			.filter(Boolean),
	);

	const photoSeals = [
		...new Set(sealResults.map((s) => v(s.extracted?.sealNumber)).filter(Boolean)),
	];

	if (bolSeals.length > 0 && photoSeals.length > 0) {
		for (const pSeal of photoSeals) {
			const cleanP = String(pSeal)
				.replace(/[^a-zA-Z0-9]/g, '')
				.toLowerCase();

			let bestMatchDistance = Infinity;
			let bestBolSeal = null;

			for (const bSeal of bolSeals) {
				const cleanB = String(bSeal)
					.replace(/[^a-zA-Z0-9]/g, '')
					.toLowerCase();
				const dist = getLevenshteinDistance(cleanP, cleanB);

				if (dist < bestMatchDistance) {
					bestMatchDistance = dist;
					bestBolSeal = bSeal;
				}
			}

			if (bestMatchDistance === 0) {
			} else if (bestMatchDistance <= 2) {
				addIssue({
					source: 'CROSS',
					severity: 'WARNING',
					cfr: 'Security / Chain of Custody',
					check: 'Seal Number Partial Match',
					message: `Seal on trailer (${pSeal}) closely resembles BOL record (${bestBolSeal}), but differs slightly. Likely an OCR read error. Please verify manually.`,
					fix: 'Manually confirm the seal number matches the BOL.',
				});
			} else {
				addIssue({
					source: 'CROSS',
					severity: 'CRITICAL',
					cfr: 'Security / Chain of Custody',
					check: 'Seal Number Mismatch',
					message: `Seal number on trailer (${pSeal}) does NOT match any seal/reference numbers declared on the BOL (${bolSeals.join(', ')}).`,
					fix: 'Investigate potential chain of custody breach. Do not accept the load without carrier and shipper authorization.',
				});
			}
		}
	} else if (photoSeals.length > 0 && bolSeals.length === 0) {
		addIssue({
			source: 'BOL',
			severity: 'WARNING',
			cfr: 'Security / Chain of Custody',
			check: 'Missing BOL Seal',
			message: `A security seal (${photoSeals.join(', ')}) is present on the trailer, but no seal number was found in the BOL documents.`,
			fix: 'Verify with the shipper if the seal number should have been documented on the Bill of Lading.',
		});
	}

	// ─────────────────────────────────────────────
	// 8. OTHER NOTES from each slot
	// ─────────────────────────────────────────────

	const pushNote = (source, note) => {
		if (!note || typeof note !== 'object' || Array.isArray(note)) return;
		const check = typeof note.sign_name === 'string' ? note.sign_name.trim() : null;
		const message = typeof note.meaning === 'string' ? note.meaning.trim() : null;
		if (!check || !message) return;
		addIssue({ source, severity: 'WARNING', cfr: null, check, message, fix: null });
	};

	for (const bol of bolResults)
		for (const note of bol.extracted?.otherNotes ?? []) pushNote('BOL', note);
	for (const marker of markerResults)
		for (const note of marker.extracted?.otherNotes ?? []) pushNote('PLACARD', note);
	for (const cargo of cargoResults)
		for (const note of cargo.extracted?.otherNotes ?? []) pushNote('CARGO', note);
	for (const seal of sealResults)
		for (const note of seal.extracted?.otherNotes ?? []) pushNote('SEAL', note);

	// ─────────────────────────────────────────────
	// 9. SCORING & SUMMARY
	// ─────────────────────────────────────────────

	const countBySeverity = (sev) => issues.filter((i) => i.severity === sev).length;
	const criticalCount = countBySeverity('CRITICAL');
	const majorCount = countBySeverity('MAJOR');
	const minorCount = countBySeverity('MINOR');
	const warningCount = countBySeverity('WARNING');

	const score = Math.max(
		0,
		100 - criticalCount * 20 - majorCount * 10 - minorCount * 3 - warningCount * 1,
	);
	const isPassed = criticalCount === 0 && majorCount === 0;

	// ─────────────────────────────────────────────
	// 10. PLACARD RECOMMENDATIONS
	// ─────────────────────────────────────────────

	const allClassesForRec = [
		...new Set([
			...bolResults.flatMap((b) => parseClasses(v(b.extracted?.hazardClass))),
			...markerResults.flatMap((m) => parseClasses(v(m.extracted?.hazardClass))),
			...cargoResults.flatMap((c) => parseClasses(v(c.extracted?.hazardClass))),
		]),
	];
	const placardRecommendations = recommendPlacards(allClassesForRec, bolWeights);

	return {
		is_passed: isPassed,
		score,
		issues,
		counts: {
			critical: criticalCount,
			major: majorCount,
			minor: minorCount,
			warning: warningCount,
		},
		placardRecommendations,
		summary: isPassed
			? `No critical or major compliance issues detected. Score: ${score}/100.`
			: `Audit FAILED. Score: ${score}/100. ${criticalCount} Critical, ${majorCount} Major, ${minorCount} Minor.`,
	};
};
