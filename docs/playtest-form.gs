// Creates the CrashLab playtest feedback form in your Google account.
// Use: open https://script.google.com, New project, paste this file, press Run on makeForm, allow access.
// The form's link is printed in the Execution log (View > Logs). Send that link to your testers.
function makeForm() {
  const form = FormApp.create('CrashLab playtest')
  form.setDescription('Thanks for testing. In the game, under "Your car", press "Copy playtest notes", then paste them into the first box. It holds your device, times and results, so you do not have to type them. Takes about 2 minutes.')
  form.setCollectEmail(false)

  form.addParagraphTextItem().setTitle('Paste your playtest notes here').setHelpText('Game > Practice tab > Your car > Copy playtest notes').setRequired(true)
  form.addParagraphTextItem().setTitle('In your own words, what is this game about?').setRequired(true)
  form.addParagraphTextItem().setTitle('What was the most confusing part?').setRequired(true)
  form.addParagraphTextItem().setTitle('Did you get stuck or need help anywhere? Where?').setRequired(false)
  form.addScaleItem().setTitle('How fun was it?').setBounds(1, 5).setLabels('Not fun', 'Very fun').setRequired(true)
  form.addMultipleChoiceItem().setTitle('Would you play it again tomorrow?').setChoiceValues(['Yes', 'Maybe', 'No']).setRequired(true)
  form.addTextItem().setTitle('What would make you want to?').setRequired(false)

  Logger.log('Send testers this link: ' + form.getPublishedUrl())
  Logger.log('You read answers here: ' + form.getEditUrl())
}
