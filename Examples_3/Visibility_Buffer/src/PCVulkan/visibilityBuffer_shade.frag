#version 450 core

/*
 * Copyright (c) 2018 Confetti Interactive Inc.
 * 
 * This file is part of The-Forge
 * (see https://github.com/ConfettiFX/The-Forge).
 * 
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 * 
 *   http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
*/

// USERMACRO: SAMPLE_COUNT [1,2,4]
// USERMACRO: USE_AMBIENT_OCCLUSION [0,1]

#extension GL_GOOGLE_include_directive : enable

#define REPEAT_TEN(base) CASE(base) CASE(base+1) CASE(base+2) CASE(base+3) CASE(base+4) CASE(base+5) CASE(base+6) CASE(base+7) CASE(base+8) CASE(base+9)
#define REPEAT_HUNDRED(base)	REPEAT_TEN(base) REPEAT_TEN(base+10) REPEAT_TEN(base+20) REPEAT_TEN(base+30) REPEAT_TEN(base+40) REPEAT_TEN(base+50) \
								REPEAT_TEN(base+60) REPEAT_TEN(base+70) REPEAT_TEN(base+80) REPEAT_TEN(base+90)

#define CASE_LIST CASE(0)	REPEAT_HUNDRED(1) REPEAT_HUNDRED(101) \
							REPEAT_TEN(201) REPEAT_TEN(211) REPEAT_TEN(221) REPEAT_TEN(231) REPEAT_TEN(241) \
							CASE(251) CASE(252) CASE(253) CASE(254) CASE(255)

#include "packing.h"
#include "shading.h"
#include "non_uniform_resource_index.h"

struct DerivativesOutput
{
	vec3 db_dx;
	vec3 db_dy;
};

// Computes the partial derivatives of a triangle from the projected screen space vertices
DerivativesOutput computePartialDerivatives(vec2 v[3])
{
	DerivativesOutput derivative;
	float d = 1.0 / determinant(mat2(v[2] - v[1], v[0] - v[1]));
	derivative.db_dx = vec3(v[1].y - v[2].y, v[2].y - v[0].y, v[0].y - v[1].y) * d;
	derivative.db_dy = vec3(v[2].x - v[1].x, v[0].x - v[2].x, v[1].x - v[0].x) * d;
	return derivative;
}

// Helper functions to interpolate vertex attributes at point 'd' using the partial derivatives
vec3 interpolateAttribute(mat3 attributes, vec3 db_dx, vec3 db_dy, vec2 d)
{
	vec3 attribute_x = attributes * db_dx;
	vec3 attribute_y = attributes * db_dy;
	vec3 attribute_s = attributes[0];
	
	return (attribute_s + d.x * attribute_x + d.y * attribute_y);
}

float interpolateAttribute(vec3 attributes, vec3 db_dx, vec3 db_dy, vec2 d)
{
	float attribute_x = dot(attributes, db_dx);
	float attribute_y = dot(attributes, db_dy);
	float attribute_s = attributes[0];
	
	return (attribute_s + d.x * attribute_x + d.y * attribute_y);
}

struct GradientInterpolationResults
{
	vec2 interp;
	vec2 dx;
	vec2 dy;
};

// Interpolate 2D attributes using the partial derivatives and generates dx and dy for texture sampling.
GradientInterpolationResults interpolateAttributeWithGradient(mat3x2 attributes, vec3 db_dx, vec3 db_dy, vec2 d, vec2 twoOverRes)
{
	vec3 attr0 = vec3(attributes[0].x, attributes[1].x, attributes[2].x);
	vec3 attr1 = vec3(attributes[0].y, attributes[1].y, attributes[2].y);
	vec2 attribute_x = vec2(dot(db_dx,attr0), dot(db_dx,attr1));
	vec2 attribute_y = vec2(dot(db_dy,attr0), dot(db_dy,attr1));
	vec2 attribute_s = attributes[0];
	
	GradientInterpolationResults result;
	result.dx = attribute_x * twoOverRes.x;
	result.dy = attribute_y * twoOverRes.y;
	result.interp = (attribute_s + d.x * attribute_x + d.y * attribute_y);
	return result;
}

struct VertexPos
{
	float x, y, z;
};

layout(std430, set = 0, binding = 0) readonly buffer vertexPos
{
	VertexPos vertexPosData[];
};

layout(std430, set = 0, binding = 1) readonly buffer vertexTexCoord
{
	uint vertexTexCoordData[];
};

layout(std430, set = 0, binding = 2) readonly buffer vertexNormal
{
	uint vertexNormalData[];
};

layout(std430, set = 0, binding = 3) readonly buffer vertexTangent
{
	uint vertexTangentData[];
};

layout(std430, set = 0, binding = 4) readonly buffer filteredIndexBuffer
{
	uint filteredIndexBufferData[];
};

layout(std430, set = 0, binding = 5) readonly buffer indirectMaterialBuffer
{
	uint indirectMaterialBufferData[];
};

layout(std430, set = 0, binding = 6) readonly buffer meshConstantsBuffer
{
	MeshConstants meshConstantsBufferData[];
};

layout(set = 0, binding = 7) uniform sampler textureSampler;
layout(set = 0, binding = 8) uniform sampler depthSampler;

// Per frame descriptors
layout(std430, set = 0, binding = 9) readonly buffer indirectDrawArgsBlock
{
	uint indirectDrawArgsData[];
} indirectDrawArgs[2];

layout(set = 0, binding = 10) uniform uniforms
{
	PerFrameConstants uniformsData;
};

layout(set = 0, binding = 11) restrict readonly buffer lights
{
	LightData lightsBuffer[];
};

layout(set = 0, binding = 12) restrict readonly buffer lightClustersCount
{
	uint lightClustersCountBuffer[];
};

layout(set = 0, binding = 13) restrict readonly buffer lightClusters
{
	uint lightClustersBuffer[];
};

#if(SAMPLE_COUNT > 1)
layout(set = 0, binding=14) uniform texture2DMS vbTex;
#else
layout(set = 0, binding=14) uniform texture2D vbTex;
#endif

#if USE_AMBIENT_OCCLUSION
layout(set = 0, binding = 15) uniform texture2D aoTex;
#endif
layout(set = 0, binding = 16) uniform texture2D shadowMap;

layout(set = 0, binding = 17) uniform texture2D diffuseMaps[MAX_TEXTURE_UNITS];
layout(set = 0, binding = 18 + MAX_TEXTURE_UNITS) uniform texture2D normalMaps[MAX_TEXTURE_UNITS];
layout(set = 0, binding = 18 + MAX_TEXTURE_UNITS * 2) uniform texture2D specularMaps[MAX_TEXTURE_UNITS];

layout(location = 0) in vec2 iScreenPos;

layout(location = 0) out vec4 oColor;

// Pixel shader
void main()
{
	// Load Visibility Buffer raw packed float4 data from render target
#if(SAMPLE_COUNT > 1)
    vec4 visRaw = texelFetch(sampler2DMS(vbTex, depthSampler), ivec2(gl_FragCoord.xy), gl_SampleID);
#else
    vec4 visRaw = texelFetch(sampler2D(vbTex, depthSampler), ivec2(gl_FragCoord.xy), 0);
#endif
    // Unpack float4 render target data into uint to extract data
    uint alphaBit_drawID_triID = packUnorm4x8(visRaw);
    
	vec3 shadedColor = vec3(1.0f, 1.0f, 1.0f);

    // Early exit if this pixel doesn't contain triangle data
	// Early exit if this pixel doesn't contain triangle data
	if (alphaBit_drawID_triID != ~0)
	{
		// Extract packed data
		uint drawID = (alphaBit_drawID_triID >> 23) & 0x000000FF;
		uint triangleID = (alphaBit_drawID_triID & 0x007FFFFF);
		uint alpha1_opaque0 = (alphaBit_drawID_triID >> 31);

		// This is the start vertex of the current draw batch
		uint startIndex = (alpha1_opaque0 == 0) ? indirectDrawArgs[0].indirectDrawArgsData[drawID * 8 + 2] : indirectDrawArgs[1].indirectDrawArgsData[drawID * 8 + 2];

		uint triIdx0 = (triangleID * 3 + 0) + startIndex;
		uint triIdx1 = (triangleID * 3 + 1) + startIndex;
		uint triIdx2 = (triangleID * 3 + 2) + startIndex;

		uint index0 = filteredIndexBufferData[triIdx0];
		uint index1 = filteredIndexBufferData[triIdx1];
		uint index2 = filteredIndexBufferData[triIdx2];

		// Load vertex data of the 3 vertices
		vec3 v0pos = vec3(vertexPosData[index0].x, vertexPosData[index0].y, vertexPosData[index0].z);
		vec3 v1pos = vec3(vertexPosData[index1].x, vertexPosData[index1].y, vertexPosData[index1].z);
		vec3 v2pos = vec3(vertexPosData[index2].x, vertexPosData[index2].y, vertexPosData[index2].z);

		// Transform positions to clip space
		vec4 pos0 = (uniformsData.transform[VIEW_CAMERA].mvp * vec4(v0pos, 1));
		vec4 pos1 = (uniformsData.transform[VIEW_CAMERA].mvp * vec4(v1pos, 1));
		vec4 pos2 = (uniformsData.transform[VIEW_CAMERA].mvp * vec4(v2pos, 1));

		// Calculate the inverse of w, since it's going to be used several times
		vec3 one_over_w = 1.0 / vec3(pos0.w, pos1.w, pos2.w);

		// Project vertex positions to calcualte 2D post-perspective positions
		pos0 *= one_over_w[0];
		pos1 *= one_over_w[1];
		pos2 *= one_over_w[2];

		vec2 pos_scr[3] = { pos0.xy, pos1.xy, pos2.xy };

		// Compute partial derivatives. This is necessary to interpolate triangle attributes per pixel.
		DerivativesOutput derivativesOut = computePartialDerivatives(pos_scr);

		// Calculate delta vector (d) that points from the projected vertex 0 to the current screen point
		vec2 d = iScreenPos + -pos_scr[0];

		// Interpolate the 1/w (one_over_w) for all three vertices of the triangle
		// using the barycentric coordinates and the delta vector
		float w = 1.0 / interpolateAttribute(one_over_w, derivativesOut.db_dx, derivativesOut.db_dy, d);

		// Reconstruct the Z value at this screen point performing only the necessary matrix * vector multiplication
		// operations that involve computing Z
		float z = w * uniformsData.transform[VIEW_CAMERA].projection[2][2] + uniformsData.transform[VIEW_CAMERA].projection[3][2];

		// Calculate the world position coordinates:
		// First the projected coordinates at this point are calculated using In.screenPos and the computed Z value at this point.
		// Then, multiplying the perspective projected coordinates by the inverse view-projection matrix (invVP) produces world coordinates
		vec3 position = (uniformsData.transform[VIEW_CAMERA].invVP * vec4(iScreenPos * w, z, w)).xyz;

		// TEXTURE COORD INTERPOLATION
		// Apply perspective correction to texture coordinates
		mat3x2 texCoords =
		{
			unpack2Floats(vertexTexCoordData[index0]) * one_over_w[0],
			unpack2Floats(vertexTexCoordData[index1]) * one_over_w[1],
			unpack2Floats(vertexTexCoordData[index2]) * one_over_w[2]
		};

		// Interpolate texture coordinates and calculate the gradients for texture sampling with mipmapping support
		GradientInterpolationResults results = interpolateAttributeWithGradient(texCoords, derivativesOut.db_dx, derivativesOut.db_dy, d, uniformsData.twoOverRes);
		vec2 texCoordDX = results.dx * w;
		vec2 texCoordDY = results.dy * w;
		vec2 texCoord = results.interp * w;

		// NORMAL INTERPOLATION
		// Apply perspective division to normals
		mat3x3 normals =
		{
			decodeDir(unpackUnorm2x16(vertexNormalData[index0])) * one_over_w[0],
			decodeDir(unpackUnorm2x16(vertexNormalData[index1])) * one_over_w[1],
			decodeDir(unpackUnorm2x16(vertexNormalData[index2])) * one_over_w[2]
		};

		vec3 normal = normalize(interpolateAttribute(normals, derivativesOut.db_dx, derivativesOut.db_dy, d));

		// TANGENT INTERPOLATION
		// Apply perspective division to tangents
		mat3x3 tangents =
		{
			decodeDir(unpackUnorm2x16(vertexTangentData[index0])) * one_over_w[0],
			decodeDir(unpackUnorm2x16(vertexTangentData[index1])) * one_over_w[1],
			decodeDir(unpackUnorm2x16(vertexTangentData[index2])) * one_over_w[2]
		};

		vec3 tangent = normalize(interpolateAttribute(tangents, derivativesOut.db_dx, derivativesOut.db_dy, d));

		uint materialBaseSlot = BaseMaterialBuffer(alpha1_opaque0 == 1, 1);
		uint materialID = indirectMaterialBufferData[materialBaseSlot + drawID];

#ifdef GL_AMD_gcn_shader
		vec2 normalMapRG;
		vec4 diffuseColor;
		vec3 specularData;
		bool isTwoSided;

		switch (materialID)
		{
			// define an enum
#define CASE(id) case id: \
normalMapRG = textureGrad(sampler2D(normalMaps[id], textureSampler), texCoord, texCoordDX, texCoordDY).rg; \
diffuseColor = textureGrad(sampler2D(diffuseMaps[id], textureSampler), texCoord, texCoordDX, texCoordDY); \
specularData = textureGrad(sampler2D(specularMaps[id], textureSampler), texCoord, texCoordDX, texCoordDY).xyz; \
isTwoSided = (alpha1_opaque0 == 1) && (meshConstantsBufferData[id].twoSided == 1); \
break;
			CASE_LIST
		}
#undef CASE
#else
		normalMapRG = textureGrad(sampler2D(normalMaps[materialID], textureSampler), texCoord, texCoordDX, texCoordDY).rg;
		diffuseColor = textureGrad(sampler2D(diffuseMaps[materialID], textureSampler), texCoord, texCoordDX, texCoordDY);
		specularData = textureGrad(sampler2D(specularMaps[materialID], textureSampler), texCoord, texCoordDX, texCoordDY).xyz;
		isTwoSided = (alpha1_opaque0 == 1) && (meshConstantsBufferData[materialID].twoSided == 1);
#endif

		vec3 reconstructedNormalMap;
		reconstructedNormalMap.xy = normalMapRG * 2 - 1;
		reconstructedNormalMap.z = sqrt(1 - dot(reconstructedNormalMap.xy, reconstructedNormalMap.xy));

		// Calculate vertex binormal from normal and tangent
		vec3 binormal = normalize(cross(tangent, normal));

		// Calculate pixel normal using the normal map and the tangent space vectors
		normal = reconstructedNormalMap.x * tangent + reconstructedNormalMap.y * binormal + reconstructedNormalMap.z * normal;

		// Sample Diffuse color
		vec4 posLS = uniformsData.transform[VIEW_SHADOW].vp * vec4(position, 1);
#if USE_AMBIENT_OCCLUSION
		float ao = texelFetch(sampler2D(aoTex, depthSampler), ivec2(gl_FragCoord.xy), 0).r;
#else
		float ao = 1.0f;
#endif

		shadedColor = calculateIllumination(normal, uniformsData.camPos.xyz, uniformsData.esmControl, uniformsData.lightDir.xyz, isTwoSided, posLS, position, shadowMap, diffuseColor.xyz, specularData.xyz, ao, depthSampler);

		// Find the light cluster for the current pixel
		uvec2 clusterCoords = uvec2(floor((iScreenPos * 0.5f + 0.5f) * uvec2(LIGHT_CLUSTER_WIDTH, LIGHT_CLUSTER_HEIGHT)));

		uint numLightsInCluster = lightClustersCountBuffer[LIGHT_CLUSTER_COUNT_POS(clusterCoords.x, clusterCoords.y)];

		// Accumulate light contributions
		for (uint i = 0; i < numLightsInCluster; i++)
		{
			uint lightId = lightClustersBuffer[LIGHT_CLUSTER_DATA_POS(i, clusterCoords.x, clusterCoords.y)];
			shadedColor += pointLightShade(lightsBuffer[lightId].position.xyz, lightsBuffer[lightId].color.xyz, uniformsData.camPos.xyz, position, normal, specularData, isTwoSided);
		}
	}

	// Output final pixel color
	oColor = vec4(shadedColor, 1);
}