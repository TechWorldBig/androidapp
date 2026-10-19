# Manual device test checklist

- Register member; verify pending state and no quiz access.
- Approve member in pastor dashboard; sign in again and verify quiz list.
- Create, publish, and start a quiz at its scheduled time.
- Verify a second attempt is refused; submit answers and verify no immediate score disclosure.
- Publish results only after scheduled end; verify the result record is private until publication.
- Background the app during quiz; inspect the event in the pastor dashboard.
- Disable network, restore it, and verify error recovery.
- Test simultaneous submissions from two devices and inspect only one result.
- Test on a physical Android device, including screen capture prevention and accessibility sizing.
- Build a signed APK; install and update it using the same signing key.
