HEART DISEASE PREDICTOR – PROJECT REPORT

Introduction:
Heart disease is one of the leading causes of death worldwide. Early detection can significantly reduce fatality rates and improve treatment outcomes. With the help of machine learning and interactive interfaces, prediction systems can offer supportive diagnostic insights.
This project is a full-stack machine learning application that predicts the likelihood of heart disease based on patient information.
Project Objectives:
1)	Build an end-to-end heart disease prediction system.
2)	Provide a smart UI for entering patient details and receiving predictions.
3)	Allow training the ML model with Default Dataset.
4)	Implement a robust, production-ready model pipeline using scikit-learn.
5)	Expose prediction and training functionality via REST API.
Components:
Frontend (index.html, styles.css, main.js)
•	User interface to input patient data.
•	Chart to show risk score visually.
•	Shows key risk factors analysis.
•	Button to train the ML model.
•	Interacts with backend using Fetch API.
Backend (main.py)
•	Built using Fast API.
•	Endpoints:
•  POST /train – trains ML model
•  POST /predict – returns prediction &     probability
•  GET /health – API health status
•	Handles CSV validation, file upload, and model saving.
ML Pipeline (pipeline.py)
•	Preprocessing:
•  Standard Scaler for numeric features
•  One Hot Encoder for categorical features
•  Simple Imputer for missing values
•	Model:
•  RandomForestClassifier
•	Metrics:
•   Accuracy, Precision, Recall, F1-score, ROC-AUC
•	Saves model to model.joblib.
 
Dataset (heart.csv):
Your dataset contains features required for heart disease prediction:
 
Machine Learning Workflow:
Preprocessing
Implemented via scikit-learn Pipeline:
•	Numeric Features:
•  Median imputation
•  Standard scaling
•	Categorical Features:
•   Most-frequent imputation
           •   One-hot encoding
 Model Training
•	Dataset split: train_test_split using validation split from UI.
•	Model: RandomForestClassifier (100 trees, random_state=42)
•	Saves model to: model.joblib
   Evaluation Metrics
Backend returns:
•	Training Accuracy
•	Validation Accuracy
•	Precision
•	Recall
•	F1-score
•	ROC-AUC

Backend API Design
Endpoints
1. POST /train
Inputs:
•	Optional CSV file
•	Validation split
•	Random state
•	Admin token (optional)
Outputs:
•	training accuracy
•	validation accuracy
•	F1 score
•	AUC score
•	model path

2. POST /predict
Input: JSON with 11 attributes
 
7. Frontend Functionality
Key Features
•	Clean UI created using custom CSS.
•	Form to input all medical fields.
•	Predict button sends JSON payload to backend.
•	Real-time risk chart visualization using canvas:
•  Blue = no disease probability
•  Red = heart disease probability
•	Key risk factors displayed dynamically (Cholesterol, BP, MaxHR, Age, etc.)
•	Training section allows uploading dataset & setting validation split.
 
Conclusion:
This project successfully implements a fully functional, production-ready machine learning web application for heart disease prediction. It includes:
•	Interactive frontend
•	Fast and scalable backend
•	Robust ML pipeline
•	Risk factor explanation system
•	CSV-based custom training capability
It demonstrates strong integration of web development, data science, and ML engineering practices.
