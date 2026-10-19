# UX contract

- Registration creates an active member profile. Members can enter their quiz dashboard immediately.
- Pastor access comes from a Firebase Auth custom claim set through a trusted Admin SDK script.
- A quiz is saved as draft and explicitly published. Only drafts may be edited.
- A member starts one attempt during the scheduled window. The server owns the deadline and score.
- Submission acknowledges receipt. Results stay private until the pastor publishes them.
- Integrity events are review signals. They never cause automatic disqualification.
- All operations show a pending state and return a text error or success message.
