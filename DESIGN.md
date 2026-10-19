# JSC Bible Quiz design

The interface is for church members taking a weekly quiz and pastors preparing it. Its visual cue is a restrained gold star over deep navy, recalling a Bible page marker without using decorative religious stock imagery.

- Navy `#102942`: primary surfaces and actions.
- Ivory `#f6f0df`: page background.
- Paper `#fffdf7`: cards and forms.
- Gold `#b58a3b`: focus and small accents.
- Ink `#455767`: secondary text.
- Display: Georgia on web headings; system sans for controls. Mobile uses the system typeface for readability and Tamil fallback.
- Controls use visible labels, borders, and 44px class touch targets where possible. Success and failure are expressed in text.

Runtime values currently live in `apps/admin/src/style.css` and mobile screen StyleSheets. Centralizing tokens is a follow-up before visual expansion.
