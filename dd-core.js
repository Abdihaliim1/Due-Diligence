/* Form 8867 review helpers. No taxpayer data leaves this device. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DDCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const REVISION = '2026-10-04';
  const FORM_SOURCE = 'https://www.irs.gov/pub/irs-pdf/f8867.pdf';
  const RETENTION = 'Keep the required records for 3 years from the latest applicable date: the return due date (without extensions), the e-file date, the date presented for signature for a paper return, or the date delivered to the signing preparer for a nonsigning preparer.';
  const benefits = c => ({ ...(c.credits_claimed || {}), hoh: !!c.credits_claimed?.hoh || c.filing_status === 'Head of Household' });
  const hasBenefits = c => Object.values(benefits(c)).some(Boolean);
  const questions = [
    ['1', 'I', 'Did you complete the return using information for the applicable tax year provided by the taxpayer or reasonably obtained by you?'],
    ['2', 'I', 'For credits claimed, did you complete the applicable worksheets and all related forms and schedules?'],
    ['3', 'I', 'Did you satisfy the knowledge requirement by interviewing the taxpayer, documenting responses as you asked, and reviewing eligibility and credit amounts?'],
    ['4', 'I', 'Did any information from the taxpayer, a third party, or otherwise known to you appear incorrect, incomplete, or inconsistent?'],
    ['4a', 'I', 'Did you make reasonable inquiries to determine the correct, complete, and consistent information?'],
    ['4b', 'I', 'Did you document those inquiries at the time, including whom and when you asked, the responses, and their effect on the return?'],
    ['5', 'I', 'Did you meet the record retention requirement, including Form 8867, worksheets, relied-on documents, information sources, and inquiry records?'],
    ['6', 'I', 'Did you ask whether the taxpayer could provide documents supporting eligibility and credit amounts if audited?'],
    ['7', 'I', 'Did you ask whether any of these credits were disallowed or reduced in a previous year?'],
    ['7a', 'I', 'If previously disallowed or reduced, did you complete the required recertification Form 8862?'],
    ['8', 'I', 'If reporting self-employment income, did you ask questions needed for a complete and correct Schedule C?'],
    ['9a', 'II', 'Have you determined EIC eligibility for the number of qualifying children claimed, or eligibility without a qualifying child?'],
    ['9b', 'II', 'For EIC with a qualifying child, did you ask whether the child lived with the taxpayer for over half the year, even if supported all year?'],
    ['9c', 'II', 'Did you explain EIC tiebreaker rules for a child who is the qualifying child of more than one person?'],
    ['10', 'III', 'Have you determined each qualifying person for CTC/ACTC/ODC is the taxpayer’s dependent and a U.S. citizen, national, or resident?'],
    ['11', 'III', 'Did you explain the CTC/ACTC residency rule and the exception for a custodial parent’s release of claim?'],
    ['12', 'III', 'Did you explain CTC/ACTC/ODC rules for parents who live apart, including any Form 8332 attachment requirement?'],
    ['13', 'IV', 'Did the taxpayer provide substantiation for AOTC, such as Form 1098-T and/or receipts for qualified tuition and related expenses?'],
    ['14', 'V', 'Have you determined the taxpayer was unmarried or considered unmarried at year-end and paid over half the cost of a home for a qualifying person?'],
    ['15', 'VI', 'Do you certify that the answers on Form 8867 are true, correct, and complete to the best of your knowledge?']
  ].map(([id, part, text]) => ({id, part, text}));
  function applicableQuestions(c) {
    if (!hasBenefits(c)) return [];
    const b = benefits(c), f = c.ddq?.form8867 || {};
    return questions.filter(q => {
      if (q.id === '4a' || q.id === '4b') return f['4'] === 'Yes';
      if (q.id === '7a') return f.prior_disallowance === 'Yes';
      if (q.part === 'II') return !!b.eitc;
      if (q.part === 'III') return !!(b.ctc || b.actc || b.odc);
      if (q.part === 'IV') return !!b.aotc;
      if (q.part === 'V') return !!b.hoh;
      return true;
    });
  }
  function allowsNA(q, c) {
    const b = benefits(c);
    if (q.id === '2') return ![b.eitc,b.ctc,b.actc,b.odc,b.aotc].some(Boolean);
    if (q.id === '8') return c.income?.self_employed === 'No';
    if (q.id === '9b' || q.id === '9c') return c.ddq?.eitc_qualifying_child === 'No';
    if (q.id === '11') return !b.ctc && !b.actc;
    if (q.id === '12') return true; // Preparers document why not applicable.
    if (q.id === '7a') return true; // Recertification exceptions require an explanation.
    return false;
  }
  function reviewIssues(c) {
    const issues = [], f = c.ddq?.form8867 || {}, b = benefits(c);
    if (Number(c.tax_year || 2025) !== 2025) issues.push('This checklist supports tax year 2025; review other years separately.');
    if (!c.name?.trim() || !c.filing_status || !(c.phone?.trim() || c.email?.trim())) issues.push('Complete client name, filing status, and contact information.');
    if (f.benefits_reviewed !== 'Yes') issues.push('Review and confirm the selected credits and filing status.');
    if (!hasBenefits(c)) return issues;
    for (const q of applicableQuestions(c)) {
      const v = f[q.id];
      if (!['Yes','No','N/A'].includes(v)) issues.push('Answer Form 8867 line ' + q.id + '.');
      else if (v === 'N/A' && !allowsNA(q,c)) issues.push('Review the N/A answer on line ' + q.id + '.');
      else if (v === 'No' && q.id !== '4') issues.push('Resolve the No answer on line ' + q.id + '.');
      if (v === 'N/A' && ['7a','12'].includes(q.id) && !f.exception_notes?.trim()) issues.push('Explain why line ' + q.id + ' is not applicable.');
    }
    if (!['Yes','No'].includes(f.prior_disallowance)) issues.push('Record whether credits were previously disallowed or reduced.');
    if (f['4'] === 'Yes' && (!f.inquiry_notes?.trim() || !f.resolution_notes?.trim())) issues.push('Record the follow-up questions, answers, and resolution of inconsistent information.');
    if (!f.information_source?.trim() || !f.interview_date) issues.push('Record when, how, and from whom you obtained the information.');
    if (!c.ddq?.docs?.trim()) issues.push('Record documents relied on, or explain the information used when no documents were relied on.');
    if (!c.ddq?.preparer_certification_date) issues.push('Enter the preparer review date.');
    if (b.eitc && !['Yes','No'].includes(c.ddq?.eitc_qualifying_child)) issues.push('Specify whether EIC is claimed with a qualifying child.');
    if ((b.eitc || b.ctc || b.actc) && f.ssn_review !== 'Yes') issues.push('Confirm the applicable taxpayer, spouse, and child SSN requirements.');
    if (c.income?.self_employed === 'Yes' && (c.ddq?.self_emp_income_verified === 'No' || c.ddq?.self_emp_records_adequate === 'No')) issues.push('Resolve the self-employment record issue.');
    if (b.eitc && c.ddq?.eitc_eligible === 'No') issues.push('EIC is selected but the taxpayer is marked ineligible.');
    if (b.eitc && c.ddq?.eitc_tiebreaker_applies === 'Pending') issues.push('Resolve the EIC tiebreaker question.');
    if (b.eitc && c.ddq?.eitc_qualifying_child === 'No' && c.ddq?.eitc_age_requirement_met === 'No') issues.push('EIC age requirements are not met.');
    if ((b.ctc || b.actc) && c.ddq?.form_8332_applies === 'Yes' && c.ddq?.form_8332_attached !== 'Yes') issues.push('Complete the required Form 8332 attachment.');
    if (b.aotc && (c.ddq?.aotc_eligible_student === 'No' || c.ddq?.aotc_felony_drug === 'Yes')) issues.push('Resolve the AOTC eligibility conflict.');
    if (b.hoh && (c.ddq?.hoh_paid_over_half === 'No' || c.ddq?.hoh_unmarried_verified === 'No')) issues.push('Resolve the head-of-household eligibility conflict.');
    if (b.hoh && c.filing_status !== 'Head of Household') issues.push('Head of Household selection does not match filing status.');
    return [...new Set(issues)];
  }
  function categoryApplies(c, category) {
    if (category === 'dependents') return (c.dependents || []).length > 0;
    if (category === 'education') return !!benefits(c).aotc;
    if (category === 'hoh') return !!benefits(c).hoh;
    return true;
  }
  function documentApplies(c, category, id) {
    if (!categoryApplies(c, category)) return false;
    if (id === 'w2_forms') return !!c.income?.w2_employer || c.income?.self_employed !== 'Yes';
    if (id === 'self_emp_records') return c.income?.self_employed === 'Yes';
    return true;
  }
  function documentSuggested(c, id) {
    if (id === 'w2_forms') return !!c.income?.w2_employer;
    if (id === 'self_emp_records') return c.income?.self_employed === 'Yes';
    if (id === 'form_8332') return c.ddq?.form_8332_applies === 'Yes';
    return false;
  }
  function ageAtYearEnd(dob, year=2025) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null;
    const [y,m,d] = dob.split('-').map(Number);
    const date = new Date(Date.UTC(y,m-1,d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m-1 || date.getUTCDate() !== d || y > year) return null;
    return year-y;
  }
  return {REVISION, FORM_SOURCE, RETENTION, questions, benefits, hasBenefits, applicableQuestions, allowsNA, reviewIssues, categoryApplies, documentApplies, documentSuggested, ageAtYearEnd};
});
