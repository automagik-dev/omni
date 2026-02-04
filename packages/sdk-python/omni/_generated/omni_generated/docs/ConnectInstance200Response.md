# ConnectInstance200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**ConnectInstance200ResponseData**](ConnectInstance200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.connect_instance200_response import ConnectInstance200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ConnectInstance200Response from a JSON string
connect_instance200_response_instance = ConnectInstance200Response.from_json(json)
# print the JSON string representation of the object
print(ConnectInstance200Response.to_json())

# convert the object into a dict
connect_instance200_response_dict = connect_instance200_response_instance.to_dict()
# create an instance of ConnectInstance200Response from a dict
connect_instance200_response_from_dict = ConnectInstance200Response.from_dict(connect_instance200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


