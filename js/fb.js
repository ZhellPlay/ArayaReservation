// Satu pintu import Firebase. Ganti config di sini saja.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";

const app = initializeApp({
    apiKey: "AIzaSyDb_Kh4oanLB6JB9EAHNRgAj9doZ-bEjFM",
    authDomain: "araya-booking-c7651.firebaseapp.com",
    projectId: "araya-booking-c7651",
    storageBucket: "araya-booking-c7651.firebasestorage.app",
    messagingSenderId: "61938475795",
    appId: "1:61938475795:web:948161570fe48fb20270e6"
});

export const db = getFirestore(app);
export const auth = getAuth(app);
export {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
    onSnapshot, runTransaction, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js";
export { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.7.1/firebase-auth.js";
