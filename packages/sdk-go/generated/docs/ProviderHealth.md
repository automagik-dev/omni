# ProviderHealth

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Healthy** | **bool** | Whether healthy | 
**Latency** | **NullableFloat32** | Latency (ms) | 
**Error** | **NullableString** | Error message | 

## Methods

### NewProviderHealth

`func NewProviderHealth(healthy bool, latency NullableFloat32, error_ NullableString, ) *ProviderHealth`

NewProviderHealth instantiates a new ProviderHealth object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewProviderHealthWithDefaults

`func NewProviderHealthWithDefaults() *ProviderHealth`

NewProviderHealthWithDefaults instantiates a new ProviderHealth object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetHealthy

`func (o *ProviderHealth) GetHealthy() bool`

GetHealthy returns the Healthy field if non-nil, zero value otherwise.

### GetHealthyOk

`func (o *ProviderHealth) GetHealthyOk() (*bool, bool)`

GetHealthyOk returns a tuple with the Healthy field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetHealthy

`func (o *ProviderHealth) SetHealthy(v bool)`

SetHealthy sets Healthy field to given value.


### GetLatency

`func (o *ProviderHealth) GetLatency() float32`

GetLatency returns the Latency field if non-nil, zero value otherwise.

### GetLatencyOk

`func (o *ProviderHealth) GetLatencyOk() (*float32, bool)`

GetLatencyOk returns a tuple with the Latency field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLatency

`func (o *ProviderHealth) SetLatency(v float32)`

SetLatency sets Latency field to given value.


### SetLatencyNil

`func (o *ProviderHealth) SetLatencyNil(b bool)`

 SetLatencyNil sets the value for Latency to be an explicit nil

### UnsetLatency
`func (o *ProviderHealth) UnsetLatency()`

UnsetLatency ensures that no value is present for Latency, not even an explicit nil
### GetError

`func (o *ProviderHealth) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *ProviderHealth) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *ProviderHealth) SetError(v string)`

SetError sets Error field to given value.


### SetErrorNil

`func (o *ProviderHealth) SetErrorNil(b bool)`

 SetErrorNil sets the value for Error to be an explicit nil

### UnsetError
`func (o *ProviderHealth) UnsetError()`

UnsetError ensures that no value is present for Error, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


