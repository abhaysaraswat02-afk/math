# Era of Mathantics

This workspace now includes a local backend API and a staff portal for managing note offerings.

## Run locally

1. Open a terminal in `c:\Users\crack\Downloads\ERAOFMATHANTICS`
2. Run:

```bash
npm install
npm start
```

3. Open the site in a browser:

- Landing page: `http://localhost:3000`
- Staff portal: `http://localhost:3000/staff.html`

## Staff portal credentials

- Username: `admin`
- Password: `era1234`

## Notes data
The backend stores note metadata in **Firebase Firestore**.
PDF files are uploaded to Cloudinary, and their URLs are stored in Firestore.

## API Endpoints

- `GET /api/notes` - public note catalog
- `POST /api/staff/login` - staff login
- `GET /api/staff/notes` - list notes for staff
- `POST /api/staff/notes` - add a note
- `PUT /api/staff/notes/:id` - update a note
- `DELETE /api/staff/notes/:id` - remove a note
