# HealthCheck

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** | Check status | 
**Latency** | Pointer to **float32** | Latency in milliseconds | [optional] 
**Error** | Pointer to **string** | Error message if status is error | [optional] 
**Details** | Pointer to **map[string]interface{}** | Additional details | [optional] 

## Methods

### NewHealthCheck

`func NewHealthCheck(status string, ) *HealthCheck`

NewHealthCheck instantiates a new HealthCheck object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewHealthCheckWithDefaults

`func NewHealthCheckWithDefaults() *HealthCheck`

NewHealthCheckWithDefaults instantiates a new HealthCheck object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *HealthCheck) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *HealthCheck) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *HealthCheck) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetLatency

`func (o *HealthCheck) GetLatency() float32`

GetLatency returns the Latency field if non-nil, zero value otherwise.

### GetLatencyOk

`func (o *HealthCheck) GetLatencyOk() (*float32, bool)`

GetLatencyOk returns a tuple with the Latency field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLatency

`func (o *HealthCheck) SetLatency(v float32)`

SetLatency sets Latency field to given value.

### HasLatency

`func (o *HealthCheck) HasLatency() bool`

HasLatency returns a boolean if a field has been set.

### GetError

`func (o *HealthCheck) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *HealthCheck) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *HealthCheck) SetError(v string)`

SetError sets Error field to given value.

### HasError

`func (o *HealthCheck) HasError() bool`

HasError returns a boolean if a field has been set.

### GetDetails

`func (o *HealthCheck) GetDetails() map[string]interface{}`

GetDetails returns the Details field if non-nil, zero value otherwise.

### GetDetailsOk

`func (o *HealthCheck) GetDetailsOk() (*map[string]interface{}, bool)`

GetDetailsOk returns a tuple with the Details field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDetails

`func (o *HealthCheck) SetDetails(v map[string]interface{})`

SetDetails sets Details field to given value.

### HasDetails

`func (o *HealthCheck) HasDetails() bool`

HasDetails returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


