// Creates the CrashLab playtest feedback form in your Google account.
// Use: open https://script.google.com, New project, paste this file, press Run on makeForm, allow access.
// The form's link is printed in the Execution log (View > Logs). Send that link to your testers.
function makeForm() {
  const form = FormApp.create('CrashLab playtest')
  form.setDescription('Thanks for testing. First play the game for about 10 minutes: build a car, train it, then race it on the Race tab, and race again if you want to. Only when you have finished playing, go to the Practice tab, press "Copy playtest notes" under "Your car", and paste them into the first box. They hold your device, times and results, so you do not have to type them. The questions below take about 2 minutes.')
  form.setCollectEmail(false)

  form.addParagraphTextItem().setTitle('Paste your playtest notes here').setHelpText('Play and race first. Then: Game > Practice tab > Your car > Copy playtest notes').setRequired(true)
  form.addParagraphTextItem().setTitle('In your own words, what is this game about?').setRequired(true)
  form.addParagraphTextItem().setTitle('What was the most confusing part?').setRequired(true)
  form.addParagraphTextItem().setTitle('Did you get stuck or need help anywhere? Where?').setRequired(false)
  form.addScaleItem().setTitle('How fun was it?').setBounds(1, 5).setLabels('Not fun', 'Very fun').setRequired(true)
  form.addMultipleChoiceItem().setTitle('Would you play it again tomorrow?').setChoiceValues(['Yes', 'Maybe', 'No']).setRequired(true)
  form.addTextItem().setTitle('What would make you want to?').setRequired(false)

  Logger.log('Send testers this link: ' + form.getPublishedUrl())
  Logger.log('You read answers here: ' + form.getEditUrl())
}
