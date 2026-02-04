# GetHealth200ResponseChecksDatabase

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** | Check status | 
**Latency** | Pointer to **float32** | Latency in milliseconds | [optional] 
**Error** | Pointer to **string** | Error message if status is error | [optional] 
**Details** | Pointer to **map[string]interface{}** | Additional details | [optional] 

## Methods

### NewGetHealth200ResponseChecksDatabase

`func NewGetHealth200ResponseChecksDatabase(status string, ) *GetHealth200ResponseChecksDatabase`

NewGetHealth200ResponseChecksDatabase instantiates a new GetHealth200ResponseChecksDatabase object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetHealth200ResponseChecksDatabaseWithDefaults

`func NewGetHealth200ResponseChecksDatabaseWithDefaults() *GetHealth200ResponseChecksDatabase`

NewGetHealth200ResponseChecksDatabaseWithDefaults instantiates a new GetHealth200ResponseChecksDatabase object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *GetHealth200ResponseChecksDatabase) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *GetHealth200ResponseChecksDatabase) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *GetHealth200ResponseChecksDatabase) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetLatency

`func (o *GetHealth200ResponseChecksDatabase) GetLatency() float32`

GetLatency returns the Latency field if non-nil, zero value otherwise.

### GetLatencyOk

`func (o *GetHealth200ResponseChecksDatabase) GetLatencyOk() (*float32, bool)`

GetLatencyOk returns a tuple with the Latency field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLatency

`func (o *GetHealth200ResponseChecksDatabase) SetLatency(v float32)`

SetLatency sets Latency field to given value.

### HasLatency

`func (o *GetHealth200ResponseChecksDatabase) HasLatency() bool`

HasLatency returns a boolean if a field has been set.

### GetError

`func (o *GetHealth200ResponseChecksDatabase) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *GetHealth200ResponseChecksDatabase) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *GetHealth200ResponseChecksDatabase) SetError(v string)`

SetError sets Error field to given value.

### HasError

`func (o *GetHealth200ResponseChecksDatabase) HasError() bool`

HasError returns a boolean if a field has been set.

### GetDetails

`func (o *GetHealth200ResponseChecksDatabase) GetDetails() map[string]interface{}`

GetDetails returns the Details field if non-nil, zero value otherwise.

### GetDetailsOk

`func (o *GetHealth200ResponseChecksDatabase) GetDetailsOk() (*map[string]interface{}, bool)`

GetDetailsOk returns a tuple with the Details field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDetails

`func (o *GetHealth200ResponseChecksDatabase) SetDetails(v map[string]interface{})`

SetDetails sets Details field to given value.

### HasDetails

`func (o *GetHealth200ResponseChecksDatabase) HasDetails() bool`

HasDetails returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


