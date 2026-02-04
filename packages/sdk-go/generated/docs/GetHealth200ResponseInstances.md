# GetHealth200ResponseInstances

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Total** | **int32** | Total instance count | 
**Connected** | **int32** | Connected instance count | 
**ByChannel** | **map[string]float32** | Count by channel type | 

## Methods

### NewGetHealth200ResponseInstances

`func NewGetHealth200ResponseInstances(total int32, connected int32, byChannel map[string]float32, ) *GetHealth200ResponseInstances`

NewGetHealth200ResponseInstances instantiates a new GetHealth200ResponseInstances object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetHealth200ResponseInstancesWithDefaults

`func NewGetHealth200ResponseInstancesWithDefaults() *GetHealth200ResponseInstances`

NewGetHealth200ResponseInstancesWithDefaults instantiates a new GetHealth200ResponseInstances object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotal

`func (o *GetHealth200ResponseInstances) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *GetHealth200ResponseInstances) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *GetHealth200ResponseInstances) SetTotal(v int32)`

SetTotal sets Total field to given value.


### GetConnected

`func (o *GetHealth200ResponseInstances) GetConnected() int32`

GetConnected returns the Connected field if non-nil, zero value otherwise.

### GetConnectedOk

`func (o *GetHealth200ResponseInstances) GetConnectedOk() (*int32, bool)`

GetConnectedOk returns a tuple with the Connected field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetConnected

`func (o *GetHealth200ResponseInstances) SetConnected(v int32)`

SetConnected sets Connected field to given value.


### GetByChannel

`func (o *GetHealth200ResponseInstances) GetByChannel() map[string]float32`

GetByChannel returns the ByChannel field if non-nil, zero value otherwise.

### GetByChannelOk

`func (o *GetHealth200ResponseInstances) GetByChannelOk() (*map[string]float32, bool)`

GetByChannelOk returns a tuple with the ByChannel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetByChannel

`func (o *GetHealth200ResponseInstances) SetByChannel(v map[string]float32)`

SetByChannel sets ByChannel field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


