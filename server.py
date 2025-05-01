from flask import Flask, request, jsonify, send_from_directory
import os
from blaze_api import BlazeAPI

app = Flask(__name__)

# Servir arquivos estáticos
@app.route('/')
def index():
    return send_from_directory('.', 'calculadora_com_api.html')

@app.route('/<path:path>')
def serve_file(path):
    return send_from_directory('.', path)

# API para verificar resultados da Blaze
@app.route('/api/check_blaze_results', methods=['POST'])
def check_blaze_results():
    try:
        data = request.json
        horarios = data.get('horarios', [])
        tolerancia = data.get('tolerancia', 2)
        
        if not horarios:
            return jsonify({
                'success': False,
                'message': 'Nenhum horário fornecido para verificação'
            })
        
        api = BlazeAPI()
        
        # Verificar cada horário calculado
        all_hits = []
        for horario in horarios:
            result = api.check_win(horario, tolerancia)
            if result['success'] and 'hits' in result:
                all_hits.extend(result['hits'])
        
        # Ordenar hits por diferença de tempo (mais próximos primeiro)
        all_hits.sort(key=lambda x: x['diff_minutes'])
        
        if all_hits:
            return jsonify({
                'success': True,
                'message': f'Encontrados {len(all_hits)} resultado(s) branco(s) próximo(s) aos horários calculados',
                'hits': all_hits
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Nenhum resultado branco encontrado próximo aos horários calculados'
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'Erro ao verificar resultados: {str(e)}'
        })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
