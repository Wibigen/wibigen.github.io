<?php
// Renvoie uniquement le texte encodé en format brut
header('Content-Type: text/plain');
if (isset($_GET['text'])) {
    echo rawurlencode($_GET['text']);
}
?>
