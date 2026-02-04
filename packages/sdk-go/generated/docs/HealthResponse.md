# HealthResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** | Overall health status | 
**Version** | **string** | API version | 
**Uptime** | **int32** | Uptime in seconds | 
**Timestamp** | **time.Time** | Current timestamp | 
**Checks** | [**GetHealth200ResponseChecks**](GetHealth200ResponseChecks.md) |  | 
**Instances** | Pointer to [**GetHealth200ResponseInstances**](GetHealth200ResponseInstances.md) |  | [optional] 

## Methods

### NewHealthResponse

`func NewHealthResponse(status string, version string, uptime int32, timestamp time.Time, checks GetHealth200ResponseChecks, ) *HealthResponse`

NewHealthResponse instantiates a new HealthResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewHealthResponseWithDefaults

`func NewHealthResponseWithDefaults() *HealthResponse`

NewHealthResponseWithDefaults instantiates a new HealthResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *HealthResponse) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *HealthResponse) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *HealthResponse) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetVersion

`func (o *HealthResponse) GetVersion() string`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *HealthResponse) GetVersionOk() (*string, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *HealthResponse) SetVersion(v string)`

SetVersion sets Version field to given value.


### GetUptime

`func (o *HealthResponse) GetUptime() int32`

GetUptime returns the Uptime field if non-nil, zero value otherwise.

### GetUptimeOk

`func (o *HealthResponse) GetUptimeOk() (*int32, bool)`

GetUptimeOk returns a tuple with the Uptime field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUptime

`func (o *HealthResponse) SetUptime(v int32)`

SetUptime sets Uptime field to given value.


### GetTimestamp

`func (o *HealthResponse) GetTimestamp() time.Time`

GetTimestamp returns the Timestamp field if non-nil, zero value otherwise.

### GetTimestampOk

`func (o *HealthResponse) GetTimestampOk() (*time.Time, bool)`

GetTimestampOk returns a tuple with the Timestamp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimestamp

`func (o *HealthResponse) SetTimestamp(v time.Time)`

SetTimestamp sets Timestamp field to given value.


### GetChecks

`func (o *HealthResponse) GetChecks() GetHealth200ResponseChecks`

GetChecks returns the Checks field if non-nil, zero value otherwise.

### GetChecksOk

`func (o *HealthResponse) GetChecksOk() (*GetHealth200ResponseChecks, bool)`

GetChecksOk returns a tuple with the Checks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChecks

`func (o *HealthResponse) SetChecks(v GetHealth200ResponseChecks)`

SetChecks sets Checks field to given value.


### GetInstances

`func (o *HealthResponse) GetInstances() GetHealth200ResponseInstances`

GetInstances returns the Instances field if non-nil, zero value otherwise.

### GetInstancesOk

`func (o *HealthResponse) GetInstancesOk() (*GetHealth200ResponseInstances, bool)`

GetInstancesOk returns a tuple with the Instances field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstances

`func (o *HealthResponse) SetInstances(v GetHealth200ResponseInstances)`

SetInstances sets Instances field to given value.

### HasInstances

`func (o *HealthResponse) HasInstances() bool`

HasInstances returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


