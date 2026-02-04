# ConnectInstanceRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Token** | Pointer to **string** | Bot token for Discord instances | [optional] 
**ForceNewQr** | Pointer to **bool** | Force new QR code for WhatsApp | [optional] 

## Methods

### NewConnectInstanceRequest

`func NewConnectInstanceRequest() *ConnectInstanceRequest`

NewConnectInstanceRequest instantiates a new ConnectInstanceRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewConnectInstanceRequestWithDefaults

`func NewConnectInstanceRequestWithDefaults() *ConnectInstanceRequest`

NewConnectInstanceRequestWithDefaults instantiates a new ConnectInstanceRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetToken

`func (o *ConnectInstanceRequest) GetToken() string`

GetToken returns the Token field if non-nil, zero value otherwise.

### GetTokenOk

`func (o *ConnectInstanceRequest) GetTokenOk() (*string, bool)`

GetTokenOk returns a tuple with the Token field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetToken

`func (o *ConnectInstanceRequest) SetToken(v string)`

SetToken sets Token field to given value.

### HasToken

`func (o *ConnectInstanceRequest) HasToken() bool`

HasToken returns a boolean if a field has been set.

### GetForceNewQr

`func (o *ConnectInstanceRequest) GetForceNewQr() bool`

GetForceNewQr returns the ForceNewQr field if non-nil, zero value otherwise.

### GetForceNewQrOk

`func (o *ConnectInstanceRequest) GetForceNewQrOk() (*bool, bool)`

GetForceNewQrOk returns a tuple with the ForceNewQr field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetForceNewQr

`func (o *ConnectInstanceRequest) SetForceNewQr(v bool)`

SetForceNewQr sets ForceNewQr field to given value.

### HasForceNewQr

`func (o *ConnectInstanceRequest) HasForceNewQr() bool`

HasForceNewQr returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


