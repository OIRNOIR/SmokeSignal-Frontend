# SmokeSignal Frontend

This is the frontend for a project I made in May-June 2024. It is an end-to-end encrypted
web-based chat application which uses the quantum-resistant cryptography algorithm
CRYSTALS-Kyber for security.

Please note that the implementation of CRYSTALS-Kyber this project depends on has since
been deprecated in favor of ML-KEM. You may wish to not deploy this project.

It isn't currently actively maintained, and hasn't been actively developed since I originally
wrote it as closed source. If you're reading this, I've released the project as open source as
of October 2025, mostly as an educational proof of concept, but also to showcase my experience.

This frontend requires a partner backend,
located [here](https://git.oirnoir.dev/OIRNOIR/SmokeSignal-Backend). Host that backend,
then replace all instances of `API_HOSTNAME` with your api's hostname and `FRONT_HOSTNAME` with
your frontend's hostname in this codebase. Then, use Cloudflare Pages or some other static site
host to serve the static content on your frontend hostname.

I apologize for the limited portability of this code, as well as the lack of Typescript. I
would rewrite this in TS but don't currently have time for anything other than releasing the
code mostly as-is. Commit history has been expunged to avoid exposing personally identifiable
information.

If you would like a small demo image, I've attached a (quite badly) censored demo I made at the time.

<img width="7168" height="4416" alt="Demo Image" src="https://github.com/user-attachments/assets/7d2c4a02-963d-4585-914b-2c0a79c7e3c6" />
